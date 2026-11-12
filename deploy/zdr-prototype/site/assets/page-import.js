/* ============================================================
   page-import.js · 数据导入（真实读取文件，不是「只改文件名」）
   ------------------------------------------------------------
   链路：选择文件 → 真解析（xlsx/csv/json）→ 列映射 → 真校验
         （身份证校验位 / 文件内重复 / 库内重复 / 镇街匹配）
         → 确认导入（写入台账并同步汇总口径）→ 生成报告
   ============================================================ */
(function () {
  'use strict';
  const D = window.DATA;
  const FP = window.FILEPARSE;
  const esc = UI.esc;

  let step = 1;                 // 1 选文件 2 映射 3 预检 4 完成
  let file = null;              // 原始 File
  let parsed = null;            // { headers, rows, name, sizeText, encoding, sheet }
  let map = {};                 // field -> col index
  let check = null;             // { rows, stat }
  let meta = { table: '公安 · 政保重点人台账', dept: '公安分局', period: '2026-11' };

  const stepsBox = document.getElementById('steps');
  const cardFile = document.getElementById('cardFile');
  const cardMap = document.getElementById('cardMap');
  const cardCheck = document.getElementById('cardCheck');

  const TABLES = [
    '公安 · 政保重点人台账', '公安 · 涉访人员台账', '公安 · 吸毒人员台账',
    '卫健 · 严重精神障碍患者台账', '卫健 · 六失一偏人员台账',
    '信访 · 涉访 A 类台账', '信访 · 涉访 B 类台账',
    '司法 · 社区矫正台账', '司法 · 刑满释放台账', '司法 · 安置帮教台账'
  ];
  const DEPTS = ['公安分局', '区卫健委', '区信访办', '区司法局', '区委政法委'];

  /* ---------- 步骤条 ---------- */
  const STEP_NAMES = ['选择文件', '字段映射', '预检结果', '确认导入', '生成报告'];
  function renderSteps() {
    stepsBox.innerHTML = STEP_NAMES.map((n, i) => {
      const no = i + 1;
      const cls = no < step ? 'done' : (no === step ? 'on' : '');
      return `<div class="step ${cls}"><span class="no">${no < step ? '✓' : no}</span><span class="tx">${n}</span></div>` +
        (i < STEP_NAMES.length - 1 ? '<span class="step-line-x"></span>' : '');
    }).join('');
  }

  /* ---------- 1. 文件 ---------- */
  function renderFile() {
    cardFile.innerHTML = `
      <div class="card-hd">
        <div class="card-title">本次导入 <span class="sub" id="batchNo">批次 IMP-${D.meta.districtDays.replace(/-/g, '')}-${String(Math.floor(Math.random() * 89) + 10)}</span></div>
        <div class="right">${parsed ? '<span class="tag tag-green">已解析 · 待映射</span>' : '<span class="tag tag-line">等待选择文件</span>'}</div>
      </div>
      <div class="card-bd" style="padding:12px 16px 14px">
        <div class="row" style="gap:12px;flex-wrap:wrap">
          <div class="field" style="flex:0 0 210px">
            <label>目标表块（共 15 类）</label>
            <div class="select" id="selTable" style="height:28px">${esc(meta.table)}</div>
          </div>
          <div class="field" style="flex:0 0 132px">
            <label>来源部门</label>
            <div class="select" id="selDept" style="height:28px">${esc(meta.dept)}</div>
          </div>
          <div class="field" style="flex:0 0 118px">
            <label>报送周期</label>
            <div class="select" id="selPeriod" style="height:28px">${esc(meta.period)}</div>
          </div>
          <div class="field grow">
            <label>经办人</label>
            <div class="input plain">${esc(STORE.role().user)}（${esc(STORE.role().title)}）</div>
          </div>
        </div>

        ${parsed ? `
        <div class="file-chip mt12">
          <div class="fc-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z"/><path d="M14 3v5h5"/></svg></div>
          <div style="flex:1 1 auto;min-width:0">
            <div class="sm strong">${esc(parsed.name)}</div>
            <div class="tiny dim">${parsed.rows.length} 行 × ${parsed.headers.length} 列 · ${esc(parsed.sizeText)} · ${esc(parsed.encoding)} · 工作表 ${esc(parsed.sheet)}</div>
          </div>
          <span class="tag tag-blue">已识别 ${parsed.headers.filter(Boolean).length}/${parsed.headers.filter(Boolean).length} 列</span>
          <button class="btn btn-sm" id="btnChange">更换</button>
        </div>
        ${parsed.warnings.length ? `<div class="tiny" style="color:var(--orange);margin-top:6px">· ${parsed.warnings.map(esc).join('；')}</div>` : ''}
        ` : `
        <div class="ui-drop mt12" id="drop">
          <div class="dt">把台账文件拖到这里，或点击选择</div>
          <div class="ds">支持 .xlsx（原生解析）、.csv（UTF-8 / GBK 自动识别）、.json（对象数组）<br>文件仅在本机浏览器内解析，不会上传到任何服务器</div>
        </div>
        <div class="row mt10" style="gap:8px">
          <span class="tiny dim" style="flex:1">没有合适文件？可先下载示例模板（含 20 行，故意包含 2 行校验位错误与 1 组重复行，用于演示拦截）</span>
          <button class="btn btn-sm" id="btnTpl2">下载示例模板</button>
        </div>`}

        <input type="file" id="fileIn" accept=".xlsx,.csv,.txt,.json" hidden>
      </div>`;

    UI.select(document.getElementById('selTable'), {
      items: TABLES, value: meta.table, onChange: v => { meta.table = v; }
    });
    UI.select(document.getElementById('selDept'), {
      items: DEPTS, value: meta.dept, onChange: v => { meta.dept = v; }
    });
    UI.select(document.getElementById('selPeriod'), {
      items: ['2026-11', '2026-10', '2026-09'], value: meta.period, onChange: v => { meta.period = v; }
    });

    const input = document.getElementById('fileIn');
    input.onchange = () => { if (input.files[0]) pick(input.files[0]); };
    const drop = document.getElementById('drop');
    if (drop) {
      drop.onclick = () => input.click();
      ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('on'); }));
      ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('on'); }));
      drop.addEventListener('drop', e => {
        const f = e.dataTransfer.files[0];
        if (f) pick(f);
      });
    }
    const chg = document.getElementById('btnChange');
    if (chg) chg.onclick = () => input.click();
    const tpl2 = document.getElementById('btnTpl2');
    if (tpl2) tpl2.onclick = downloadTemplate;
  }

  async function pick(f) {
    if (f.size > 12 * 1024 * 1024) { UI.toast.err('文件超过 12 MB，请拆分后导入'); return; }
    UI.toast('正在解析 ' + f.name + ' …');
    try {
      const res = await FP.read(f);
      file = f; parsed = res;
      map = FP.guessMap(res.headers);
      step = 2;
      renderAll();
      UI.toast.ok('解析成功 · ' + res.rows.length + ' 行 × ' + res.headers.length + ' 列（' + res.encoding + '）');
    } catch (err) {
      UI.toast.err('解析失败：' + err.message);
    }
  }

  /* ---------- 2. 字段映射 ---------- */
  function renderMap() {
    if (!parsed) {
      cardMap.innerHTML = `<div class="card-hd"><div class="card-title">字段映射 <span class="sub">配一次，后续同表块复用</span></div></div>
        <div class="card-bd" style="padding:0">${UI.empty('尚未选择文件', '选择文件后自动识别表头并给出映射建议，可逐列调整')}</div>`;
      return;
    }
    const matched = FP.FIELDS.filter(f => map[f.key] >= 0).length;
    const need = FP.FIELDS.filter(f => f.key === 'name' || f.key === 'idNo');
    const ready = need.every(f => map[f.key] >= 0);
    cardMap.innerHTML = `
      <div class="card-hd">
        <div class="card-title">字段映射 <span class="sub">已匹配 ${matched} / ${FP.FIELDS.length} · 姓名与身份证号必填</span></div>
        <div class="right">
          <span class="tag ${ready ? 'tag-green' : 'tag-amber'}">${ready ? '必填项已就绪' : '缺少必填列'}</span>
        </div>
      </div>
      <div class="card-bd" style="padding:0;max-height:280px;overflow:auto">
        <table class="tb compact">
          <thead><tr><th style="width:150px">源表头</th><th style="width:26px"></th><th style="width:150px">标准字段</th><th>转换规则</th><th style="width:74px" class="r">状态</th></tr></thead>
          <tbody>${FP.FIELDS.map(f => {
            const idx = map[f.key];
            const src = idx >= 0 ? parsed.headers[idx] : '（未匹配）';
            return `<tr>
              <td>${esc(src)}</td><td class="c arrow">→</td>
              <td><div class="select" data-k="${f.key}" style="height:24px;font-size:11px">${esc(f.label)}</div></td>
              <td class="tiny dim">${ruleOf(f.key)}</td>
              <td class="r"><span class="tag ${idx >= 0 ? (f.key === 'name' || f.key === 'idNo' ? 'tag-green' : 'tag-blue') : 'tag-line'}">${idx >= 0 ? '已匹配' : '未匹配'}</span></td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>
      <div class="card-ft">
        <button class="btn btn-sm btn-primary" id="btnToCheck" ${ready ? '' : 'disabled'}>下一步：预检</button>
      </div>`;

    cardMap.querySelectorAll('.select[data-k]').forEach(node => {
      const k = node.dataset.k;
      UI.select(node, {
        items: [{ v: -1, t: '（不导入该字段）' }].concat(parsed.headers.map((h, i) => ({ v: i, t: h || '第 ' + (i + 1) + ' 列' }))),
        value: map[k],
        onChange: v => { map[k] = Number(v); recheck(); renderMap(); renderCheck(); }
      });
    });
    const go = document.getElementById('btnToCheck');
    if (go) go.onclick = () => { step = 3; recheck(); renderAll(); };
  }

  function ruleOf(key) {
    return ({
      name: '去空格 · 生成拼音首字母',
      idNo: '校验位验证 · 生成去重键',
      phone: '格式归一 · 加密存储',
      tags: '按 /、；切分 · 字典归一',
      town: '匹配 20 个镇街名称',
      dept: '部门字典归一',
      level: '五档等级字典归一',
      note: '进入扩展字段，原文留存'
    })[key] || '';
  }

  /* ---------- 3. 预检 ---------- */
  function recheck() {
    if (!parsed) return;
    const dbIds = new Set(D.persons.map(p => p.idNo));
    check = FP.validate(parsed.rows, map, { dbIds, towns: D.towns.map(t => t.key) });
  }

  function renderCheck() {
    if (!parsed || !check) {
      cardCheck.innerHTML = `<div class="card-hd"><div class="card-title">预检结果 <span class="sub">未写入数据库，确认后才生效</span></div></div>
        <div class="card-bd">${UI.empty('尚未开始预检', '选择文件并完成字段映射后，将按身份证校验位、库内重复、镇街匹配逐行校验')}</div>`;
      return;
    }
    const s = check.stat;
    const bad = check.rows.filter(r => r.status !== 'ok');
    const dupRows = check.rows.filter(r => r.status === 'dup');
    const imported = check.rows.filter(r => r.status === 'ok' || r.status === 'warn');

    cardCheck.innerHTML = `
      <div class="card-hd">
        <div class="card-title">预检结果 <span class="sub">未写入数据库，确认后才生效</span></div>
        <div class="right">
          <span class="tag ${s.total ? 'tag-green' : 'tag-line'}">读取 ${s.total} 行</span>
          ${bad.length ? `<a class="btn btn-sm btn-ghost" id="btnErr">下载错误行 ›</a>` : ''}
        </div>
      </div>
      <div class="card-bd" style="padding:12px 16px 14px">
        <div class="grid g4" style="gap:10px">
          <div class="stat-tile"><div class="v">${s.total}</div><div class="l">读取行数</div></div>
          <div class="stat-tile" style="background:var(--blue-soft);border-color:var(--blue-soft-2)"><div class="v" style="color:var(--blue-ink)">${s.ok}</div><div class="l">可新增</div></div>
          <div class="stat-tile" style="background:var(--orange-soft);border-color:rgba(232,131,12,.2)"><div class="v" style="color:#a35c00">${s.dup}</div><div class="l">重复 / 合并</div></div>
          <div class="stat-tile" style="background:var(--red-soft);border-color:rgba(217,45,32,.18)"><div class="v" style="color:var(--red)">${s.fail}</div><div class="l">拦截错误行</div></div>
        </div>

        ${dupRows.length ? `
        <div class="mt12" style="border:1px solid rgba(232,131,12,.26);background:#fffaf2;border-radius:10px;padding:11px 12px">
          <div class="row" style="gap:7px">
            <span class="flag dual">自动合并</span>
            <b class="sm">身份证号命中既有档案，将按「追加标签、不覆盖部门判断」合并</b>
            <span class="spacer"></span><span class="tag tag-line">${dupRows.length} 行</span>
          </div>
          <div class="grid g2 mt10" style="gap:6px 16px">
            ${dupRows.slice(0, 4).map(r => {
              const old = D.persons.find(p => p.idNo === r.idNo);
              return `<div class="tiny" style="padding:3px 0;border-bottom:1px solid var(--line)">
                <b>${esc(r.name)}</b> · 第 ${r.line} 行 · ${esc(old ? old.no : '')} · ${esc(old ? old.tags.join('/') : '')} → 追加 ${esc(r.tags.join('/'))}
              </div>`;
            }).join('')}
          </div>
        </div>` : ''}

        <div class="mt12">
          <div class="sect-title">拦截与告警明细 <span style="font-weight:400;color:var(--t4)">共 ${bad.length} 行</span></div>
          ${bad.length ? `<div class="ui-preview"><table class="tb compact">
            <thead><tr><th style="width:60px">行号</th><th style="width:80px">姓名</th><th>问题</th><th style="width:76px">级别</th></tr></thead>
            <tbody>${bad.slice(0, 40).map(r => `<tr class="${r.status === 'fail' ? 'err-line' : ''}">
              <td class="num">${r.line}</td>
              <td>${esc(r.name || '—')}</td>
              <td>${esc(r.reason)}${r.idNo ? '（' + esc(r.idNo.slice(0, 6) + '********' + r.idNo.slice(-4)) + '）' : ''}</td>
              <td><span class="tag ${r.status === 'fail' ? 'tag-red' : r.status === 'dup' ? 'tag-blue' : 'tag-amber'}">${r.status === 'fail' ? '拦截' : r.status === 'dup' ? '合并' : '告警'}</span></td>
            </tr>`).join('')}</tbody>
          </table></div>` : '<div class="tiny dim" style="padding:6px 0">全部行通过校验，无拦截与告警。</div>'}
        </div>

        <div class="row mt12" style="gap:8px">
          <span class="tiny dim" style="flex:1">导入后自动重算：管控等级（就高不就低）、双在册/多标标识、镇街统计、驾驶舱指标</span>
          <button class="btn" id="btnBackMap">返回修改映射</button>
          <button class="btn btn-primary" id="btnImport" ${imported.length ? '' : 'disabled'}>确认导入 ${imported.length} 条</button>
        </div>
      </div>`;

    const eb = document.getElementById('btnErr');
    if (eb) eb.onclick = () => {
      const rows = [['行号', '姓名', '身份证号', '问题', '状态']].concat(
        bad.map(r => [r.line, r.name, r.idNo, r.reason, r.status])
      );
      UI.downloadCSV('导入错误行_' + parsed.name.replace(/\.[^.]+$/, '') + '.csv', rows);
      UI.toast.ok('已下载 ' + bad.length + ' 行错误明细');
    };
    const bk = document.getElementById('btnBackMap');
    if (bk) bk.onclick = backToMap;
    const imp = document.getElementById('btnImport');
    if (imp) imp.onclick = confirmImport;
  }

  /* 返回字段映射：切换步骤 + 滚动定位并高亮映射卡（否则页面无位移，观感像按钮失灵） */
  function backToMap() {
    step = 2;
    renderAll();
    const card = document.getElementById('cardMap');
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.remove('flash-target');
      void card.offsetWidth;
      card.classList.add('flash-target');
      setTimeout(() => card.classList.remove('flash-target'), 2400);
    }
    UI.toast('已返回字段映射 · 调整列位后点「下一步：预检」重新校验（下方预检结果暂留作对照）');
  }

  /* ---------- 4. 确认导入 ---------- */
  function confirmImport() {
    if (!window.guard('import', '数据导入')) return;
    const targets = check.rows.filter(r => r.status === 'ok' || r.status === 'warn');
    const dupCount = check.rows.filter(r => r.status === 'dup').length;
    UI.confirm({
      title: '确认导入 ' + targets.length + ' 条？',
      sub: '导入后立即写入台账并重算汇总口径；批次与源文件信息全部留档',
      body: `<dl class="kv" style="grid-template-columns:78px 1fr;font-size:12px">
        <dt>目标表块</dt><dd>${esc(meta.table)}</dd>
        <dt>来源部门</dt><dd>${esc(meta.dept)} · 报送周期 ${esc(meta.period)}</dd>
        <dt>源文件</dt><dd>${esc(parsed.name)}（${esc(parsed.sizeText)}）</dd>
        <dt>新增</dt><dd><b>${targets.length}</b> 条</dd>
        <dt>合并</dt><dd>${dupCount} 条（仅追加标签）</dd>
        <dt>拦截</dt><dd>${check.stat.fail} 条（不导入）</dd>
      </dl>`,
      okText: '确认导入',
      onOk: () => {
        const before = D.stats.inRegister;
        const added = D.addPersons(targets.map(r => ({
          name: r.name, idNo: r.idNo, phone: r.phone, tags: r.tags,
          town: r.town, dept: r.dept || meta.dept, level: r.level, addr: r.note
        })));
        // 落库快照写入会话：跳页 / 刷新后重放，人员台账与驾驶舱指标同步可见
        STORE.recordImported(added);
        const rec = {
          id: 'IMP-' + D.meta.districtDays.replace(/-/g, '') + '-' + String(100 + STORE.imports().length),
          name: parsed.name, dept: meta.dept, time: STORE.now(),
          total: check.stat.total, ok: added.length, dup: dupCount, fail: check.stat.fail,
          operator: STORE.role().user, status: '已完成', table: meta.table
        };
        STORE.addImport(rec);
        step = 4;
        renderAll();
        renderReport(rec, added, before);
        if (window.SYNC_METRICS) window.SYNC_METRICS();
        UI.toast.ok('导入完成 · 新增 ' + added.length + ' 条，合并 ' + dupCount + ' 条；已同步至人员台账');
      }
    });
  }

  /* ---------- 5. 报告 ---------- */
  function renderReport(rec, added, before) {
    const card = document.getElementById('cardCheck');
    if (!card) return;
    const after = D.stats.inRegister;
    card.innerHTML = `
      <div class="card-hd">
        <div class="card-title">导入完成 · ${esc(rec.id)} <span class="sub">${esc(rec.name)}</span></div>
        <div class="right"><span class="tag tag-green">已完成</span></div>
      </div>
      <div class="card-bd" style="padding:12px 16px 14px">
        <div class="grid g4" style="gap:10px">
          <div class="stat-tile"><div class="v">${rec.total}</div><div class="l">读取行数</div></div>
          <div class="stat-tile" style="background:var(--blue-soft);border-color:var(--blue-soft-2)"><div class="v" style="color:var(--blue-ink)">${rec.ok}</div><div class="l">已新增</div></div>
          <div class="stat-tile" style="background:var(--orange-soft);border-color:rgba(232,131,12,.2)"><div class="v" style="color:#a35c00">${rec.dup}</div><div class="l">已合并</div></div>
          <div class="stat-tile" style="background:var(--red-soft);border-color:rgba(217,45,32,.18)"><div class="v" style="color:var(--red)">${rec.fail}</div><div class="l">已拦截</div></div>
        </div>
        <div class="banner banner-ok mt12" style="margin-bottom:0">
          <span>已写入台账 <b>${rec.ok}</b> 条 · 全区在册由 ${D.fmt(before)} 更新为 <b>${D.fmt(after)}</b> 人 · 高风险及以上 <b>${D.stats.highPlus}</b> 人 · 批次与源文件信息已留档，可在右侧批次列表与审计日志中追溯</span>
        </div>
        <div class="mt12">
          <div class="sect-title">本次新增人员（前 8 条）</div>
          <div class="ui-preview"><table class="tb compact">
            <thead><tr><th style="width:74px">姓名</th><th style="width:150px">身份证号</th><th>标签</th><th style="width:86px">镇街</th><th style="width:78px">等级</th></tr></thead>
            <tbody>${added.slice(0, 8).map(p => `<tr>
              <td class="cell-main"><a href="person.html?id=${encodeURIComponent(p.id)}" style="color:var(--blue)">${esc(D.field(STORE.role().key, 'name', p).text)}</a></td>
              <td class="mask">${esc(D.field(STORE.role().key, 'idNo', p).text)}</td>
              <td class="tiny">${esc(p.tags.join(' / '))}</td>
              <td class="tiny">${esc(p.town)}</td>
              <td><span class="${D.levelOf(p.level).cls}">${D.levelOf(p.level).name}</span></td>
            </tr>`).join('')}</tbody>
          </table></div>
        </div>
        <div class="row mt12" style="gap:8px">
          <span class="tiny dim" style="flex:1">下次同表块导入将自动沿用本次字段映射</span>
          <a class="btn" href="persons.html?quick=imported">在人员台账中查看 ›</a>
          <button class="btn" id="btnReport">下载导入报告</button>
          <button class="btn btn-primary" id="btnRestart">再导入一批</button>
        </div>
      </div>`;

    document.getElementById('btnReport').onclick = () => {
      const rows = [['批次', '表块', '来源部门', '源文件', '读取', '新增', '合并', '拦截', '经办人', '时间']];
      rows.push([rec.id, rec.table, rec.dept, rec.name, rec.total, rec.ok, rec.dup, rec.fail, rec.operator, rec.time]);
      rows.push([]);
      rows.push(['姓名', '身份证号', '镇街', '等级', '标签']);
      added.forEach(p => rows.push([p.name, p.idNo, p.town, D.levelOf(p.level).name, p.tags.join('/')]));
      UI.downloadCSV('导入报告_' + rec.id + '.csv', rows);
      STORE.addExport('导入报告 ' + rec.id, added.length, '明文导出');
      UI.toast.ok('报告已下载');
    };
    document.getElementById('btnRestart').onclick = () => {
      file = null; parsed = null; check = null; map = {}; step = 1;
      renderAll();
    };
  }

  /* ---------- 右栏批次 ---------- */
  function renderBatches() {
    const body = document.getElementById('batchBody');
    if (!body) return;
    const list = STORE.imports();
    body.innerHTML = list.map(b => `<tr title="${esc(b.name || '')}">
      <td><span class="cell-main">${esc(b.id)}</span><span class="cell-sub">${esc((b.table || b.dept).replace('台账', ''))} · ${esc(b.operator)} · ${esc(b.time.slice(5, 16))}</span></td>
      <td class="r"><span class="tag ${b.fail ? 'tag-amber' : 'tag-green'}">${b.fail ? b.fail + ' 行拦截' : '新增 ' + b.ok}</span></td>
    </tr>`).join('');
    const cnt = document.getElementById('batchCnt');
    if (cnt) cnt.textContent = '近 30 天 ' + list.length + ' 批';
  }

  /* ---------- 模板下载 ---------- */
  function downloadTemplate() {
    UI.downloadCSV('重点风险人员台账_标准模板_含示例20行.csv', FP.sampleCSV());
    UI.toast.ok('模板已下载 · 可修改后重新拖回本页体验真实解析与校验');
  }

  /* ---------- 页头按钮 ---------- */
  document.getElementById('btnTpl').onclick = downloadTemplate;
  document.getElementById('btnPick').onclick = () => {
    const input = document.getElementById('fileIn');
    if (input) input.click();
  };
  document.getElementById('btnMapCfg').onclick = () => {
    UI.modal({
      title: '字段映射与合并规则',
      sub: '新增第 12 类人员只需新增表块与映射，不改代码',
      width: 540,
      okText: '知道了',
      body: `<div class="note" style="line-height:1.85;font-size:12px">
        <b style="color:var(--t1)">1. 唯一键：</b>身份证号哈希；姓名相同不合并（同名不同人为常态，错并后果重于漏并）。<br>
        <b style="color:var(--t1)">2. 校验位：</b>按 GB 11643 计算第 18 位校验码，不通过即拦截，不进入台账。<br>
        <b style="color:var(--t1)">3. 同标签重复：</b>按 <span class="mono tiny">(person, category, dept)</span> 唯一约束合并，不追加重复记录。<br>
        <b style="color:var(--t1)">4. 等级冲突：</b>两部门等级不一致时保留双方原值，管控等级取高。<br>
        <b style="color:var(--t1)">5. 镇街匹配：</b>按 20 个镇街名称标准化；无法匹配进入「待归属」，不参与统计。
      </div>`
    });
  };

  /* 一屏化只在「初始未选文件」态生效：
     此时四张卡内容固定，整页不滚动即可看全，超出部分由各卡的内部滚动窗承接；
     一旦解析出文件、字段映射与预检结果展开，卡片需要按内容长高，
     这里移除 body.fit 让页面恢复自然高度（允许整页滚动），不再受一屏高度限制。 */
  function syncFit() {
    const fit = step === 1 && !parsed;
    document.body.classList.toggle('fit', fit);
  }

  function renderAll() {
    syncFit();
    renderSteps();
    renderFile();
    renderMap();
    if (step >= 3) recheck();
    if (step !== 4) renderCheck();
    renderBatches();
  }

  renderAll();

  /* ---------- 报送催办单（右栏卡脚链接） ---------- */
  const btnUrgent = document.getElementById('btnUrgent');
  if (btnUrgent) btnUrgent.onclick = e => {
    e.preventDefault();
    if (!window.guard('import', '生成报送催办单')) return;
    UI.modal({
      title: '生成报送催办单',
      sub: '本月应报 15 表块 · 已收 14 / 15',
      width: 480,
      okText: '发送催办单',
      body: `
        <div class="table-wrap" style="border:1px solid var(--line);border-radius:9px">
          <table class="tb compact"><thead><tr><th>报送单位</th><th class="c" style="width:90px">状态</th><th class="r" style="width:80px">逾期</th></tr></thead>
          <tbody>
            <tr><td class="cell-main">区司法局</td><td class="c"><span class="tag tag-amber">迟报</span></td><td class="r num" style="color:var(--orange)">3 天</td></tr>
            <tr><td class="cell-main">区民政局</td><td class="c"><span class="tag tag-red">未报</span></td><td class="r num" style="color:var(--red)">5 天</td></tr>
          </tbody></table>
        </div>
        <div class="tiny dim" style="margin-top:9px">催办单将推送至单位负责人与经办人，要求 2 个工作日内补报；连发两月未报的将纳入政法委月度通报。</div>`,
      onOk: () => {
        STORE.audit('生成报送催办单', '区司法局（迟报 3 天）、区民政局（未报 5 天）', '数据导入');
        UI.toast.ok('催办单已发送至 2 个单位，状态更新为「已催办」');
      }
    });
  };
})();
