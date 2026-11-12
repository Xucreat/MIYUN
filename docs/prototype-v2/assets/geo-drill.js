/* ============================================================
   geo-drill.js · 真实边界地图 + 二级村域拼块 + 下钻轮播
   ------------------------------------------------------------
   供大屏（bigscreen.html）「镇街分布」使用。
   数据源：window.MIYUN_GEO（20 镇街真实边界 d + viewBox）与
          window.DATA.towns（在册 / 高风险 / 双在册 / 见面率）。
   与态势驾驶舱的地图同源，但独立实现，不影响驾驶舱现有代码。

   能力：
     mount()      一级：按在册人数着色 + 形心两行标注 + 悬浮明细 + 点击下钻
     drill(name)  二级：viewBox 聚焦该镇街 + canvas 栅格化村域拼块
                       （着色严格等于镇界形状，界内无空白）
     up()         回到一级
     rotate       下钻轮播：全 20 镇街按在册人数从多到少，每站停留 1.5s
     pause/resume 鼠标移入、点击、切走站点时暂停
   ============================================================ */
window.GeoDrill = (function () {
  'use strict';
  const SVGNS = 'http://www.w3.org/2000/svg';

  /* ---------- 工具 ---------- */
  function el(tag, attrs) {
    const e = document.createElementNS(SVGNS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  const shortName = n => n.replace(/(街道|地区|镇)$/, '');
  /* 两段式色阶：最浅也保持明确蓝调，避免与白底混淆 */
  function ramp(t) {
    t = Math.max(0, Math.min(1, t));
    const c1 = [206, 226, 247], c2 = [24, 92, 178];
    return 'rgb(' + c1.map((v, i) => Math.round(v + (c2[i] - v) * t)).join(',') + ')';
  }
  const textOn = t => (t > 0.56 ? '#ffffff' : '#123c66');
  function norm(v, min, max) {
    if (max === min) return 0.5;
    return Math.pow((v - min) / (max - min), 0.55);
  }
  /* 按权重把总量拆到 n 个社区，保证求和与镇街总数一致 */
  function splitTotal(total, n, seed) {
    const w = [];
    for (let i = 0; i < n; i++) w.push(0.62 + Math.abs(Math.sin(seed * 7.3 + i * 2.7)));
    const sum = w.reduce((a, b) => a + b, 0);
    const out = w.map(v => Math.floor(total * v / sum));
    let rem = total - out.reduce((a, b) => a + b, 0);
    for (let i = 0; rem > 0; i++, rem--) out[i % n]++;
    return out;
  }
  const fmt = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  function mount(opt) {
    const o = opt || {};
    const svg = document.getElementById(o.svg || 'bsMapSvg');
    const gCells = document.getElementById(o.cells || 'bsMapCells');
    const tip = document.getElementById(o.tip || 'bsMapTip');
    const geo = window.MIYUN_GEO, towns = window.DATA.towns;
    if (!svg || !gCells || !geo || !towns) return null;

    const TOWN = {};
    towns.forEach(t => { TOWN[t.name] = t; });
    const homeView = geo.viewBox;

    let level = 1, curTown = null;
    let rot = null;

    /* ---------- 提示卡 ---------- */
    function showTip(html, evt) {
      if (!tip) return;
      tip.innerHTML = html;
      tip.classList.add('on');
      const w = tip.offsetWidth, h = tip.offsetHeight;
      let x = evt.clientX + 14, y = evt.clientY - h - 12;
      if (x + w > innerWidth - 8) x = evt.clientX - w - 14;
      if (y < 8) y = evt.clientY + 16;
      tip.style.left = Math.max(8, Math.min(x, innerWidth - w - 8)) + 'px';
      tip.style.top = Math.max(8, Math.min(y, innerHeight - h - 8)) + 'px';
    }
    function hideTip() { if (tip) tip.classList.remove('on'); }

    /* ---------- viewBox 缓动 ---------- */
    let animId = 0;
    function setView(v) { svg.setAttribute('viewBox', v.join(' ')); }
    function viewNow() {
      return svg.getAttribute('viewBox').split(/[\s,]+/).map(Number);
    }
    function tweenView(to, ms, done) {
      const from = viewNow();
      const id = ++animId;
      const t0 = performance.now();
      let fired = false;
      const finish = () => {
        if (fired || id !== animId) return;
        fired = true;
        setView(to);
        if (done) done();
      };
      /* 兜底：rAF 在后台标签页 / 无渲染帧环境会被节流甚至不触发，
         到时必须直接落到终值，否则轮播会永远卡在当前站。
         兜底也要校验 animId：旧动画的兜底只在 step 里被清理，而 step 靠 rAF 驱动，
         rAF 不跑时旧兜底会晚到并覆盖掉新视野（表现为视野突然跳回上一站）。 */
      const guard = setTimeout(finish, (ms || 1) + 140);
      (function step(now) {
        if (id !== animId) { clearTimeout(guard); return; }
        /* 下界必须钳 0：rAF 的时间戳与 performance.now() 未必同源
           （无头 / 后台标签页 / 虚拟时钟下首个回调可能早于 t0），
           一旦 p 为负，缓动的 2p² 项会把 e 放大 4 倍以上，
           viewBox 会被插值成负宽高，地图直接失控 */
        const p = Math.max(0, Math.min(1, (now - t0) / (ms || 1)));
        const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        setView([0, 1, 2, 3].map(i => from[i] + (to[i] - from[i]) * e));
        if (p < 1) requestAnimationFrame(step);
        else { clearTimeout(guard); finish(); }
      })(t0);
    }
    function pxPerUnit(vw, vh) {
      const r = svg.getBoundingClientRect();
      if (!vw || !vh || !r.width || !r.height) return 1;
      return Math.max(0.35, Math.min(r.width / vw, r.height / vh));
    }

    /* ---------- 一级：20 个镇街（真实边界） ---------- */
    function level1() {
      level = 1; curTown = null;
      /* 作废在飞的视野动画：否则刚回到一级，残留的下钻动画还会把视野拖回上一站 */
      animId++;
      gCells.innerHTML = '';
      gCells.removeAttribute('clip-path');
      gCells.style.opacity = '1';
      setView(homeView.split(/[\s,]+/).map(Number));

      const vals = towns.map(t => t.v);
      const vmax = Math.max.apply(null, vals), vmin = Math.min.apply(null, vals);
      const hv = homeView.split(/[\s,]+/).map(Number);
      const ppu = pxPerUnit(hv[2], hv[3]);
      const labels = [];

      towns.forEach(t => {
        const g = geo.towns.find(x => x.n === t.name);
        if (!g) return;
        const ratio = norm(t.v, vmin, vmax);
        const p = el('path', {
          d: g.d, fill: ramp(ratio), stroke: '#ffffff', 'stroke-width': 1.6 / ppu
        });
        p.setAttribute('class', 'gd-cell');
        p.addEventListener('mousemove', e => {
          showTip(
            `<div class="tt">${t.name}<span class="gd-chip">镇街</span></div>
             <div class="tr"><span>在册人数</span><b>${t.v} 人</b></div>
             <div class="tr"><span>高风险及以上</span><b>${t.h} 人 · ${(t.h / t.v * 100).toFixed(1)}%</b></div>
             <div class="tr"><span>双在册</span><b>${t.d} 人</b></div>
             <div class="tr"><span>重点时期见面率</span><b>${t.m}%</b></div>
             <div class="th">包联干部 ${t.officer} · 社区/村 ${t.villages.length} 个 · 点击下钻</div>`, e);
        });
        p.addEventListener('mouseleave', hideTip);
        p.addEventListener('click', () => { pause(); level2(t.name); });
        gCells.appendChild(p);
        labels.push({ g, t, ratio });
      });

      /* 标注：面积过小的城区单元只画定位点，其余在形心处两行标注 */
      labels.forEach(({ g, t, ratio }) => {
        const on = textOn(ratio);
        if (g.lb) {
          gCells.appendChild(el('circle', { cx: g.c[0], cy: g.c[1], r: 1.6, fill: '#123c66', opacity: 0.4 }));
          return;
        }
        const t1 = el('text', {
          x: g.c[0], y: g.c[1] - 1, 'text-anchor': 'middle', fill: on,
          class: 'gd-val', style: 'font-size:' + (13 / ppu).toFixed(2) + 'px'
        });
        t1.textContent = t.v;
        const t2 = el('text', {
          x: g.c[0], y: g.c[1] + 10 / ppu, 'text-anchor': 'middle', fill: on,
          class: 'gd-lbl', opacity: 0.9, style: 'font-size:' + (10.5 / ppu).toFixed(2) + 'px'
        });
        t2.textContent = shortName(t.name);
        gCells.appendChild(t1);
        gCells.appendChild(t2);
      });

      if (o.onLevel) o.onLevel(1, null);
    }

    /* ---------- 多边形工具：镇界是单环 M/L/Z，可直接做精确裁切 ---------- */
    function parseRing(d) {
      const nums = d.match(/-?\d*\.?\d+/g) || [];
      const ring = [];
      for (let i = 0; i + 1 < nums.length; i += 2) ring.push([+nums[i], +nums[i + 1]]);
      return ring;
    }
    function inRing(p, ring) {
      let hit = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
        if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) hit = !hit;
      }
      return hit;
    }
    /* 保留 nx*x + ny*y <= c 的一侧（Sutherland–Hodgman 单半平面裁切） */
    function clipHalf(ring, nx, ny, c) {
      const out = [];
      const len = ring.length;
      for (let i = 0; i < len; i++) {
        const A = ring[i], B = ring[(i + 1) % len];
        const da = nx * A[0] + ny * A[1] - c;
        const db = nx * B[0] + ny * B[1] - c;
        if (da <= 0) out.push(A);
        if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
          const k = da / (da - db);
          out.push([A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k]);
        }
      }
      return out;
    }
    function ringPath(ring) {
      let s = '';
      for (let i = 0; i < ring.length; i++) s += (i ? 'L' : 'M') + ring[i][0].toFixed(2) + ' ' + ring[i][1].toFixed(2);
      return s + 'Z';
    }
    function ringBox(ring) {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      ring.forEach(p => {
        if (p[0] < x0) x0 = p[0];
        if (p[0] > x1) x1 = p[0];
        if (p[1] < y0) y0 = p[1];
        if (p[1] > y1) y1 = p[1];
      });
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    function ringCenter(ring) {
      let a2 = 0, cx = 0, cy = 0;
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i], q = ring[(i + 1) % ring.length];
        const f = p[0] * q[1] - q[0] * p[1];
        a2 += f; cx += (p[0] + q[0]) * f; cy += (p[1] + q[1]) * f;
      }
      if (Math.abs(a2) < 1e-9) { const b = ringBox(ring); return [b.x + b.w / 2, b.y + b.h / 2]; }
      return [cx / (3 * a2), cy / (3 * a2)];
    }

    /* ---------- 二级：镇街内村域拼块（Voronoi ∩ 镇界，纯矢量） ---------- */
    function level2(name) {
      const t = TOWN[name];
      const g = geo.towns.find(x => x.n === name);
      if (!t || !g) return;
      const prevLevel = level;
      level = 2; curTown = name;
      hideTip();
      animId++;

      const ring = parseRing(g.d);
      const bb = ringBox(ring);

      /* 视野：镇界外扩 7%，再撑到与画布同比例，宽卡片里不留大片空白 */
      const pad = Math.max(bb.w, bb.h) * 0.07;
      let vx = bb.x - pad, vy = bb.y - pad;
      let vw = bb.w + pad * 2, vh = bb.h + pad * 2;
      const sr = svg.getBoundingClientRect();
      const ar = (sr.width && sr.height) ? sr.width / sr.height : 1.6;
      if (vw / vh < ar) { const nw = vh * ar; vx -= (nw - vw) / 2; vw = nw; }
      else { const nh = vw / ar; vy -= (nh - vh) / 2; vh = nh; }
      const target = [vx, vy, vw, vh];
      const ppu = pxPerUnit(vw, vh);

      gCells.style.opacity = '0';
      gCells.innerHTML = '';

      /* 其余 19 个镇街淡灰，保留地理参照 */
      towns.forEach(o2 => {
        const og = geo.towns.find(x => x.n === o2.name);
        if (!og || o2.name === name) return;
        gCells.appendChild(el('path', { d: og.d, fill: '#eef1f5', stroke: '#dce2e9', 'stroke-width': 1.2 / ppu }));
      });
      /* 目标镇街底色：极浅蓝，村块之间的细缝不会漏成纯白 */
      gCells.appendChild(el('path', { d: g.d, fill: '#f4f8fd', stroke: '#8ab4de', 'stroke-width': 2 / ppu }));

      /* ---- 村域：种子点 + 半平面裁切镇界 ----
         逐像素栅格化的村界是锯齿，且 <image> 在部分环境（无头截图 / 后台标签）
         不参与合成；纯矢量边界干净、可缩放，每个村还能独立响应悬浮。 */
      const n = t.villages.length;
      const vals = splitTotal(t.v, n, name.charCodeAt(0) + n);
      const vmax = Math.max.apply(null, vals), vmin = Math.min.apply(null, vals);
      const step = Math.max(2.2, Math.min(bb.w, bb.h) / 20);
      const cand = [];
      for (let y = bb.y + step * 0.5; y < bb.y + bb.h; y += step) {
        for (let x = bb.x + step * 0.5; x < bb.x + bb.w; x += step) {
          if (inRing([x, y], ring)) cand.push([x, y]);
        }
      }
      const seeds = [];
      if (cand.length) {
        /* 首个种子取最靠界内的候选，村块不从镇界边缘起算 */
        const mid = ringCenter(ring);
        let first = cand[0], fd = 1e18;
        cand.forEach(p => {
          if (!inRing([p[0] - step, p[1]], ring) || !inRing([p[0] + step, p[1]], ring)) return;
          if (!inRing([p[0], p[1] - step], ring) || !inRing([p[0], p[1] + step], ring)) return;
          const dx = p[0] - mid[0], dy = p[1] - mid[1], d2 = dx * dx + dy * dy;
          if (d2 < fd) { fd = d2; first = p; }
        });
        seeds.push(first);
        const nTarget = Math.min(n, cand.length);
        while (seeds.length < nTarget) {
          let best = null, bd = -1;
          for (let ci = 0; ci < cand.length; ci++) {
            const c = cand[ci];
            let m2 = 1e18;
            for (let si = 0; si < seeds.length; si++) {
              const dx = c[0] - seeds[si][0], dy = c[1] - seeds[si][1], d2 = dx * dx + dy * dy;
              if (d2 < m2) m2 = d2;
            }
            if (m2 > bd) { bd = m2; best = c; }
          }
          if (!best) break;
          seeds.push(best);
        }
      }

      const cellG = el('g', {});
      const parts = [];
      for (let i = 0; i < seeds.length; i++) {
        let r = ring;
        for (let j = 0; j < seeds.length && r.length >= 3; j++) {
          if (i === j) continue;
          const si = seeds[i], sj = seeds[j];
          /* 比到 si 更近的一侧：2(sj-si)·p <= |sj|² - |si|² */
          r = clipHalf(r, 2 * (sj[0] - si[0]), 2 * (sj[1] - si[1]),
            sj[0] * sj[0] + sj[1] * sj[1] - si[0] * si[0] - si[1] * si[1]);
        }
        if (r.length < 3) continue;
        const ratio = norm(vals[i], vmin, vmax);
        const p = el('path', { d: ringPath(r), fill: ramp(ratio), stroke: '#ffffff', 'stroke-width': 1.4 / ppu });
        p.style.cursor = 'zoom-out';
        p.addEventListener('mousemove', e => {
          showTip(
            `<div class="tt">${t.villages[i]}<span class="gd-chip">社区 / 村</span></div>
             <div class="tr"><span>在册人数</span><b>${vals[i]} 人</b></div>
             <div class="tr"><span>所属镇街</span><b>${t.name}</b></div>
             <div class="th">点击返回全区视图</div>`, e);
        });
        p.addEventListener('mouseleave', hideTip);
        p.addEventListener('click', () => back());
        cellG.appendChild(p);
        parts.push({ ring: r, i, ratio });
      }
      gCells.appendChild(cellG);

      /* 村名与数值：按村块实际可用宽高决定显示层级 */
      const labelG = el('g', {});
      parts.forEach(pt => {
        const bx = ringBox(pt.ring), ct = ringCenter(pt.ring);
        const wVis = bx.w * ppu * 0.7, hVis = bx.h * ppu * 0.7;
        const numStr = String(vals[pt.i]);
        const nm = t.villages[pt.i].replace(/(社区|村)$/, '');
        const canNum = wVis >= numStr.length * 12 * 0.64 + 6 && hVis >= 15;
        const canName = canNum && wVis >= nm.length * 10.5 * 1.06 + 8 && hVis >= 28;
        if (!canNum) return;
        const txt = textOn(pt.ratio);
        const t1 = el('text', {
          x: ct[0], y: ct[1] + (canName ? -2 / ppu : 4 / ppu), 'text-anchor': 'middle',
          fill: txt, class: 'gd-val', style: 'font-size:' + (12 / ppu).toFixed(2) + 'px'
        });
        t1.textContent = numStr;
        labelG.appendChild(t1);
        if (canName) {
          const t2 = el('text', {
            x: ct[0], y: ct[1] + 11 / ppu, 'text-anchor': 'middle',
            fill: txt, class: 'gd-lbl', opacity: 0.92, style: 'font-size:' + (10.5 / ppu).toFixed(2) + 'px'
          });
          t2.textContent = nm;
          labelG.appendChild(t2);
        }
      });
      gCells.appendChild(labelG);

      /* 视野动画：下钻的同时淡入内容 */
      if (o.onLevel) o.onLevel(2, name);
      if (prevLevel !== 2) fadeIn(gCells, 240, 180);
      else gCells.style.opacity = '1';
      tweenView(target, 560);
    }

    function fadeIn(node, delay, ms) {
      node.style.transition = 'none';
      node.style.opacity = '0';
      setTimeout(() => {
        node.style.transition = 'opacity ' + ms + 'ms ease';
        node.style.opacity = '1';
      }, delay);
    }

    /* ---------- 返回一级 ---------- */
    function back() {
      if (level === 1) return;
      const target = homeView.split(/[\s,]+/).map(Number);
      level = 1;
      tweenView(target, 520, () => { level1(); });
      if (o.onLevel) o.onLevel(1, null);
    }

    /* ---------- 下钻轮播：全 20 镇街，每站停留 1.5s ---------- */
    const DWELL = 1500;
    let dwellMs = DWELL;
    function order() {
      return towns.slice().sort((a, b) => b.v - a.v).map(t => t.name);
    }
    function runRotate(seq, from, lead) {
      rot = { alive: true, paused: false, idx: from, timer: 0, seq };
      const wait = dwellMs;
      function tick() {
        if (!rot || !rot.alive || rot.paused) return;
        const i = rot.idx;
        const name = seq[i];
        if (o.onStation) o.onStation(i, seq.length, name);
        level2(name);
        rot.timer = setTimeout(() => {
          if (!rot || !rot.alive || rot.paused) return;
          level = 1;
          gCells.style.opacity = '1';
          tweenView(homeView.split(/[\s,]+/).map(Number), 460, () => {
            if (!rot || !rot.alive || rot.paused) return;
            level1();
            rot.idx = (i + 1) % seq.length;
            rot.timer = setTimeout(tick, 200);
          });
        }, wait);
      }
      /* 首次启动先在一级全景停留一会儿，让观众看到整体分布再开始下钻 */
      rot.timer = setTimeout(tick, lead ? 900 : 240);
    }
    function startRotate(dwell) {
      stopRotate();
      dwellMs = dwell || DWELL;
      runRotate(order(), 0, true);
    }
    function stopRotate() {
      if (rot) { rot.alive = false; clearTimeout(rot.timer); rot = null; }
      if (o.onPause) o.onPause(false);
    }
    function pause() {
      if (!rot || rot.paused) return;
      rot.paused = true;
      clearTimeout(rot.timer);
      if (o.onPause) o.onPause(true);
    }
    function resume() {
      if (!rot || !rot.paused) return;
      const seq = rot.seq, from = rot.idx;
      rot.paused = false;
      stopRotate();
      runRotate(seq, from, false);
    }
    const rotating = () => !!(rot && rot.alive && !rot.paused);

    /* ---------- 尺寸变化重算字号 ---------- */
    let rzTimer = 0;
    window.addEventListener('resize', () => {
      clearTimeout(rzTimer);
      rzTimer = setTimeout(() => {
        if (level === 2 && curTown) level2(curTown);
        else if (level === 1) level1();
      }, 220);
    });

    level1();

    return {
      level: () => level,
      town: () => curTown,
      level1, level2, back,
      startRotate, stopRotate, pause, resume, rotating,
      hideTip
    };
  }

  return { mount };
})();
