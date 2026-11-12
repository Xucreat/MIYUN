/* ============================================================
   page-bigscreen.js · 大屏模式 · 会议室自动轮播
   ------------------------------------------------------------
   1. 实时时钟（替换静态时间）
   2. KPI 数字入场滚动
   3. 镇街色块：数值 / 色阶 / tooltip 全部同源于 DATA.towns
   4. 排名条生长动画
   5. 地图下钻轮播：全 20 镇街按在册人数降序循环，底部解说条跟随当前镇街
      空格暂停/继续，←/→ 手动切换面板，点击面板直接跳站
   ============================================================ */
(function () {
  'use strict';
  const D = window.DATA;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const pad = n => String(n).padStart(2, '0');

  /* ---------- 1. 实时时钟 ---------- */
  const clock = $('.sc-clock');
  const asOf = $('#scAsOf');
  (function tick() {
    const d = new Date();
    if (clock) clock.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    // 「数据截至」固定滞后 2 分钟，与时钟保持一致，避免会议室里出现"09:45 截至 / 17:34 现在"的割裂
    if (asOf) {
      const t = new Date(d.getTime() - 2 * 60 * 1000);
      const md = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
      asOf.textContent = `数据截至 ${md} ${pad(t.getHours())}:${pad(t.getMinutes())}`;
    }
    // 对齐到下一个整秒，避免 setTimeout 累积漂移
    setTimeout(tick, 1000 - (Date.now() % 1000) + 4);
  })();

  /* ---------- 2. KPI 数字入场 ---------- */
  $$('.kpi-strip .sk .v').forEach(v => {
    const node = v.childNodes[0];
    if (!node || node.nodeType !== 3) return;
    const m = String(node.nodeValue).match(/^([^\d]*)([\d,]+)(.*)$/);
    if (!m) return;
    const target = parseInt(m[2].replace(/,/g, ''), 10);
    const pre = m[1], post = m[3], comma = m[2].indexOf(',') >= 0;
    const fmt = n => (comma ? n.toLocaleString('en-US') : String(n));
    const t0 = performance.now(), dur = 1150;
    node.nodeValue = pre + fmt(0) + post;
    requestAnimationFrame(function step(now) {
      const k = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      node.nodeValue = pre + fmt(Math.round(target * e)) + post;
      if (k < 1) requestAnimationFrame(step);
    });
    // 兜底：rAF 被节流（后台标签页 / 无头截图）时也必须落在终值，绝不停在半路
    setTimeout(() => { node.nodeValue = pre + fmt(target) + post; }, dur + 150);
  });

  /* ---------- 3. 镇街分布：真实边界地图 + 下钻轮播（assets/geo-drill.js） ----------
     旧的 CSS Grid 矩形色块已替换为 MIYUN_GEO 真实镇街边界：
     一级按在册人数着色并在形心标注，二级下钻到社区/村（canvas 村域拼块），
     站点激活时按在册人数从多到少自动轮播，每站停留 1.5s。 */
  let bsMap = null;
  if (window.GeoDrill) {
    bsMap = window.GeoDrill.mount({
      svg: 'bsMapSvg',
      cells: 'bsMapCells',
      tip: 'bsMapTip',
      onLevel: (lv, name) => {
        const crumb = $('#bsCrumb');
        if (crumb) crumb.textContent = lv === 1 ? '全区 20 个镇街' : name;
      },
      onStation: (i, total, name) => {
        const rotEl = $('#bsRot');
        if (rotEl) rotEl.textContent = `轮播 ${i + 1}/${total} · ${name}`;
        /* 站内解说跟随当前下钻镇街（整屏巡览已取消，解说只服务地图这一站） */
        if (idx === 0) syncTownCaption(name);
      },
      onPause: on => {
        const btn = $('#bsRotBtn');
        if (btn) btn.textContent = on ? '继续' : '暂停';
        const rotEl = $('#bsRot');
        if (rotEl && on) rotEl.textContent = rotEl.textContent.replace(/^轮播/, '已暂停');
      }
    });
  }
  /* 调试句柄：控制台可直接 level1() / level2('鼓楼街道') / stopRotate()，便于核对视野与轮播 */
  window.__bsMap = bsMap;
  /* 鼠标移入地图暂停轮播，移出继续；点击地图直接暂停（转手动浏览） */
  const bsMapBox = $('.bs-map');
  if (bsMap && bsMapBox) {
    bsMapBox.addEventListener('mouseenter', () => bsMap.pause());
    bsMapBox.addEventListener('mouseleave', () => bsMap.resume());
  }
  const bsRotBtn = $('#bsRotBtn');
  if (bsMap && bsRotBtn) {
    /* 大屏不加载 ui.js，提示直接写在轮播状态位，避免引入额外依赖 */
    const flash = txt => {
      const n = $('#bsRot');
      if (!n) return;
      n.textContent = txt;
      setTimeout(() => { if (bsMap.rotating()) n.textContent = n.textContent.replace(/^已暂停 · /, ''); }, 1600);
    };
    bsRotBtn.onclick = () => {
      if (bsMap.rotating()) { bsMap.pause(); flash('已暂停 · 手动浏览'); }
      else { bsMap.resume(); flash('已继续 · 下钻轮播'); }
    };
  }

  /* ---------- 4. 排名条：先归零，巡览到本面板再依次生长 ---------- */
  $$('.sc-rank .rr .br i').forEach(i => {
    i.dataset.w = i.style.width || '0%';
    i.style.width = '0%';
  });
  let rankTimers = [];
  function growRank() {
    rankTimers.forEach(clearTimeout);
    rankTimers = [];
    $$('.sc-rank .rr').forEach((rr, ri) => {
      $$('.br i', rr).forEach((seg, si) => {
        rankTimers.push(setTimeout(() => { seg.style.width = seg.dataset.w; }, ri * 55 + si * 90));
      });
    });
  }

  /* ---------- 5. 巡览控制条 ----------
     注意：整屏「焦点巡览」的自动切站已取消。
     原因是地图一站（下钻 560 + 停留 + 回退 460 + 间隔 200）需要约 2.7s，
     而 20 个镇街跑一轮约 55s，整屏 9s 自动切站会在第 3~4 站打断轮播，
     还会顺带切走面板高亮与底部解说；绕回地图站时又从第 1 站重来，
     后面的镇街永远轮不到。现在只保留地图这一站自己的下钻轮播，面板切换改手动。 */
  const panels = $$('.sc-body .panel');
  const TOWN = {};
  (D.towns || []).forEach(t => { TOWN[t.name] = t; });

  // 解说文案中的口径全部可与台账对账：
  //   486 = Σ towns[].h；6028 = Σ towns[].v；127 = Σ towns[].d
  //   26.0% = (812+756)/6028；69.8% = 前十镇街合计/6028
  //   10.2% = 612/6028；89.3% = 368/412
  const SPOTS = [
    {
      t: '镇街分布',
      d: '按责任镇街着色，色深人密。鼓楼街道 812 人、果园街道 756 人，城区两街道合计占全区 26.0%，是巡防与见面力量的首要投放方向。'
    },
    {
      t: '近 12 个月总量趋势',
      d: '在册总量连续 12 个月单边上行，累计净增约 380 人，未见回落拐点；新增量近 3 个月趋于平缓，消减量同步抬升。'
    },
    {
      t: '镇街排名',
      d: '前十个镇街承载全区 69.8% 的在册人员，前两名均为城区街道；其余 10 个镇街平均不足 130 人，宜按片区合并盯控。'
    },
    {
      t: '风险等级结构',
      d: '6,028 人在册：第一档 486 人（8.1%）、第二档 1,704 人、第三档 3,226 人、待核实 612 人。待核实 10.2% 尚未定级，是本月数据治理重点。'
    },
    {
      t: '重点时期盯控',
      d: '一级响应第 10 天：应见 408 人、已见 364 人，见面率 89.2%；44 人未见面、其中 44 人已标注原因。今日 14/20 镇街已提交零报告，剩余 6 个镇街已过截止时刻需督办。'
    }
  ];

  const N = Math.min(panels.length, SPOTS.length);

  /* ---- 控制条（无自动前进，仅手动切换） ---- */
  const bar = document.createElement('div');
  bar.className = 'sc-tour';
  bar.innerHTML = `
    <div class="tt-cap"><b id="ttTitle"></b><span id="ttDesc"></span></div>
    <div class="tt-ctl">
      <span class="tt-idx" id="ttIdx"></span>
      <div class="tt-dots" id="ttDots"></div>
      <button class="tt-btn" id="ttPrev" title="上一站（←）">‹</button>
      <button class="tt-btn" id="ttPause" title="暂停 / 继续地图轮播（空格）">暂停</button>
      <button class="tt-btn" id="ttNext" title="下一站（→）">›</button>
    </div>`;
  document.body.appendChild(bar);

  const elTitle = $('#ttTitle'), elDesc = $('#ttDesc'), elIdx = $('#ttIdx');
  const elDots = $('#ttDots'), elPause = $('#ttPause');
  for (let i = 0; i < N; i++) elDots.appendChild(document.createElement('i'));
  const dotEls = $$('#ttDots i');

  let idx = -1, paused = false;

  /* 镇街分布站点激活时启动下钻轮播，切到其它站点立即停止回到全区视图 */
  function litMap() {
    if (!bsMap) return;
    bsMap.level1();
    /* 停留时长从下钻动画开始时计时，560ms 用来把视野推到位，
       所以这里给 2000，视觉上的稳定停留约 1.4s */
    bsMap.startRotate(2000);
  }

  /* 站内解说跟随当前下钻镇街：标题带镇街名，正文为该镇街的台账口径 */
  function syncTownCaption(name) {
    const t = TOWN[name];
    if (!t || !elTitle) return;
    const pct = (t.h / t.v * 100).toFixed(1);
    elTitle.textContent = '镇街分布 · ' + t.short;
    const txt = `在册 ${t.v} 人 · 高风险及以上 ${t.h} 人（${pct}%）· 双在册 ${t.d} 人 · 重点时期见面率 ${t.m}% · 包联干部 ${t.officer}；全区按责任镇街着色，色深人密，点击地图可下钻到社区/村。`;
    elDesc.textContent = txt;
    elDesc.title = txt;
  }

  function goTo(i) {
    if (!N) return;
    idx = ((i % N) + N) % N;
    panels.forEach((p, k) => p.classList.toggle('spot', k === idx));
    if (idx === 0) {
      /* 地图站的标题/正文由 syncTownCaption 按当前镇街写入，这里先给个占位 */
      elTitle.textContent = SPOTS[0].t;
      elDesc.textContent = SPOTS[0].d;
      elDesc.title = SPOTS[0].d;
    } else {
      elTitle.textContent = SPOTS[idx].t;
      elDesc.textContent = SPOTS[idx].d;
      elDesc.title = SPOTS[idx].d;
    }
    elIdx.textContent = `${pad(idx + 1)} / ${pad(N)}`;
    dotEls.forEach((d, k) => d.classList.toggle('on', k === idx));
    if (bsMap) {
      if (idx === 0) litMap();
      else if (bsMap.level() !== 1 || bsMap.rotating()) { bsMap.stopRotate(); bsMap.level1(); }
    }
    if (idx === 2) growRank();
  }

  function setPaused(v) {
    paused = v;
    elPause.textContent = paused ? '继续' : '暂停';
    elPause.classList.toggle('on', paused);
    /* 暂停即暂停地图下钻轮播；继续时仅在镇街站点恢复 */
    if (bsMap) {
      if (paused) bsMap.pause();
      else if (idx === 0) bsMap.resume();
    }
  }

  $('#ttPrev').addEventListener('click', () => goTo(idx - 1));
  $('#ttNext').addEventListener('click', () => goTo(idx + 1));
  elPause.addEventListener('click', () => setPaused(!paused));

  // 点击面板 → 直接跳到该站（自动巡览已取消，这是切换到其它面板的唯一入口，除 ←/→ 外）
  panels.forEach((p, k) => {
    p.style.cursor = 'pointer';
    p.addEventListener('click', () => { if (k < N) goTo(k); });
  });

  // 键盘：空格暂停 / ←→ 切换
  document.addEventListener('keydown', e => {
    if (e.code === 'Space') { e.preventDefault(); setPaused(!paused); }
    else if (e.code === 'ArrowRight') { e.preventDefault(); goTo(idx + 1); }
    else if (e.code === 'ArrowLeft') { e.preventDefault(); goTo(idx - 1); }
  });

  /* ---- 启动：常驻镇街分布，地图 20 站无限循环 ---- */
  goTo(0);
  growRank();               // 排名条先长满，手动切到镇街排名站时无需再等
})();
