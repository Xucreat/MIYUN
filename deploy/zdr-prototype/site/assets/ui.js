/* ============================================================
   ui.js · 交互原语（全站统一）
   ------------------------------------------------------------
   Toast / Confirm / Modal / Select / Checkbox / Seg / Chips /
   Pager / SortTable / FieldRender / CSV 导出
   约定：只操作行为，不改变既有版式与视觉基线；样式集中在本文件注入。
   ============================================================ */
window.UI = (function () {
  'use strict';

  /* ---------- 0. 样式（仅补齐交互所需，沿用设计令牌） ---------- */
  const CSS = `
  .ui-toasts { position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); z-index: 9999; display: flex; flex-direction: column; gap: 8px; align-items: center; pointer-events: none; }
  .ui-toast { pointer-events: auto; display: flex; align-items: flex-start; gap: 9px; min-width: 240px; max-width: 460px;
    background: #fff; border: 1px solid var(--line-2); border-radius: 11px; padding: 10px 13px; font-size: 12.5px; color: var(--t1);
    box-shadow: 0 10px 30px rgba(16,24,40,.16), 0 2px 6px rgba(16,24,40,.08); animation: uiIn .18s ease-out; }
  .ui-toast.out { animation: uiOut .18s ease-in forwards; }
  .ui-toast i { width: 3px; align-self: stretch; border-radius: 2px; background: var(--blue); flex: 0 0 3px; }
  .ui-toast.ok i { background: var(--green); } .ui-toast.warn i { background: var(--orange); }
  .ui-toast.err i { background: var(--red); }
  .ui-toast .tx { flex: 1 1 auto; line-height: 1.55; }
  .ui-toast .tx b { font-weight: 650; }
  @keyframes uiIn { from { opacity: 0; transform: translateY(8px) scale(.98); } to { opacity: 1; transform: none; } }
  @keyframes uiOut { to { opacity: 0; transform: translateY(6px) scale(.99); } }

  .ui-mask { position: fixed; inset: 0; background: rgba(12,26,45,.34); backdrop-filter: blur(1.5px); z-index: 9000;
    display: flex; align-items: center; justify-content: center; padding: 24px; animation: uiFade .14s ease-out; }
  @keyframes uiFade { from { opacity: 0 } to { opacity: 1 } }
  .ui-dlg { width: 460px; max-width: 100%; max-height: 86vh; display: flex; flex-direction: column; background: #fff; border-radius: 15px;
    box-shadow: 0 24px 70px rgba(9,30,60,.26); overflow: hidden; animation: uiPop .16s cubic-bezier(.2,.9,.3,1.1); }
  @keyframes uiPop { from { opacity: 0; transform: translateY(10px) scale(.985); } to { opacity: 1; transform: none; } }
  .ui-dlg-hd { display: flex; align-items: flex-start; gap: 10px; padding: 16px 18px 12px; }
  .ui-dlg-hd .tt { font-size: 15px; font-weight: 650; letter-spacing: -.2px; }
  .ui-dlg-hd .st { font-size: 11.5px; color: var(--t3); margin-top: 3px; line-height: 1.6; }
  .ui-dlg-hd .x { margin-left: auto; width: 24px; height: 24px; border-radius: 7px; border: 0; background: transparent; color: var(--t3); font-size: 14px; cursor: pointer; }
  .ui-dlg-hd .x:hover { background: var(--surface-3); color: var(--t1); }
  .ui-dlg-bd { padding: 0 18px 4px; overflow: auto; font-size: 12.5px; color: var(--t2); line-height: 1.7; }
  .ui-dlg-ft { display: flex; align-items: center; gap: 8px; padding: 13px 18px 15px; border-top: 1px solid var(--line); margin-top: 10px; }
  .ui-dlg-ft .spacer { flex: 1 1 auto; }
  .ui-dlg .fld { margin-top: 10px; }
  .ui-dlg .fld > label { display: block; font-size: 11.5px; font-weight: 600; color: var(--t2); margin-bottom: 5px; }
  .ui-dlg textarea, .ui-dlg input[type=text] { width: 100%; box-sizing: border-box; border: 1px solid var(--line-2); border-radius: 9px;
    padding: 8px 10px; font-size: 12.5px; font-family: inherit; color: var(--t1); outline: 0; background: #fff; }
  .ui-dlg textarea:focus, .ui-dlg input[type=text]:focus { border-color: var(--blue); box-shadow: 0 0 0 3px rgba(0,113,227,.10); }
  .ui-dlg textarea { min-height: 74px; resize: vertical; line-height: 1.6; }
  .ui-radio { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
  .ui-radio label { display: flex; gap: 8px; align-items: flex-start; padding: 8px 10px; border: 1px solid var(--line-2); border-radius: 9px; cursor: pointer; }
  .ui-radio label:hover { background: var(--surface-2); }
  .ui-radio label.on { border-color: var(--blue); background: var(--blue-soft); }
  .ui-radio b { font-weight: 600; color: var(--t1); font-size: 12px; }
  .ui-radio span { font-size: 11px; color: var(--t3); }

  /* 真下拉 */
  .ui-sel { position: relative; }
  .ui-sel.is-empty { color: var(--t4); }
  .ui-pop { position: fixed; z-index: 9200; min-width: 132px; background: #fff; border: 1px solid var(--line-2); border-radius: 10px;
    box-shadow: 0 14px 36px rgba(16,24,40,.16); padding: 5px; max-height: 280px; overflow: auto; animation: uiIn .12s ease-out; }
  .ui-pop .op { display: flex; align-items: center; gap: 7px; padding: 6px 9px; border-radius: 7px; font-size: 12px; color: var(--t1); cursor: pointer; white-space: nowrap; }
  .ui-pop .op:hover { background: var(--surface-3); }
  .ui-pop .op.on { background: var(--blue-soft); color: var(--blue-ink); font-weight: 600; }
  .ui-pop .op .ck { margin-left: auto; color: var(--blue); font-weight: 700; }
  .ui-pop .op .cnt { margin-left: auto; font-size: 10.5px; color: var(--t3); }
  .ui-pop .grp { padding: 6px 9px 3px; font-size: 10px; font-weight: 650; letter-spacing: .4px; color: var(--t4); }
  .ui-pop .grp:not(:first-child) { margin-top: 3px; border-top: 1px solid var(--line); padding-top: 7px; }

  /* 日期 / 时间选择器（作用在 readonly input 上，值仍写回 input.value） */
  .ui-dt, .ui-tm-in { background-image: linear-gradient(transparent, transparent); }
  input.ui-dt, input.ui-tm-in { cursor: pointer; padding-right: 24px; background-repeat: no-repeat;
    background-position: right 7px center; background-size: 12px 12px; }
  input.ui-dt { background-image: url("data:image/svg+xml;charset=utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='%238b96a5' stroke-width='1.4'%3E%3Crect x='2' y='3.2' width='12' height='10.6' rx='2'/%3E%3Cpath d='M2 6.6h12M5.4 1.8v2.6M10.6 1.8v2.6'/%3E%3C/svg%3E"); }
  input.ui-tm-in { background-image: url("data:image/svg+xml;charset=utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='%238b96a5' stroke-width='1.4'%3E%3Ccircle cx='8' cy='8' r='6'/%3E%3Cpath d='M8 4.6V8l2.4 1.6'/%3E%3C/svg%3E"); }

  .ui-pop.ui-cal { padding: 9px; width: 252px; max-height: none; overflow: visible; }
  .ui-cal-hd { display: flex; align-items: center; gap: 4px; margin-bottom: 6px; }
  .ui-cal-hd .mv { width: 24px; height: 24px; border: 0; background: transparent; border-radius: 6px; cursor: pointer;
    color: var(--t2); font-size: 13px; line-height: 1; }
  .ui-cal-hd .mv:hover { background: var(--surface-3); color: var(--t1); }
  .ui-cal-hd .m { flex: 1 1 auto; text-align: center; font-size: 12.5px; font-weight: 650; color: var(--t1); font-variant-numeric: tabular-nums; }
  .ui-cal-wd { display: grid; grid-template-columns: repeat(7, 1fr); font-size: 9.5px; font-weight: 600; color: var(--t4); text-align: center; margin-bottom: 3px; }
  .ui-cal-gd { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
  .ui-cal-gd span { height: 26px; display: grid; place-items: center; font-size: 11.5px; border-radius: 6px;
    cursor: pointer; color: var(--t1); font-variant-numeric: tabular-nums; }
  .ui-cal-gd span:hover { background: var(--surface-3); }
  .ui-cal-gd span.mut { color: var(--t4); }
  .ui-cal-gd span.tdy { box-shadow: inset 0 0 0 1px var(--blue-soft-2); color: var(--blue-ink); font-weight: 600; }
  .ui-cal-gd span.on { background: var(--blue); color: #fff; font-weight: 650; box-shadow: none; }
  .ui-cal-ft { display: flex; align-items: center; gap: 6px; margin-top: 7px; padding-top: 7px; border-top: 1px solid var(--line); }
  .ui-cal-ft .spacer { flex: 1 1 auto; }

  .ui-pop.ui-tm { width: 196px; max-height: none; overflow: visible; padding: 9px; }
  .ui-tm-bd { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }
  .ui-tm-col { border: 1px solid var(--line); border-radius: 8px; padding: 2px; max-height: 168px; overflow: auto; }
  .ui-tm-col b { position: sticky; top: 0; display: block; background: #fff; font-size: 9.5px; font-weight: 650;
    color: var(--t4); padding: 3px 6px 2px; }
  .ui-tm-col span { display: flex; align-items: center; height: 23px; padding: 0 8px; border-radius: 6px;
    font-size: 11.5px; cursor: pointer; color: var(--t1); font-variant-numeric: tabular-nums; }
  .ui-tm-col span:hover { background: var(--surface-3); }
  .ui-tm-col span.on { background: var(--blue); color: #fff; font-weight: 650; }
  .ui-tm-ft { display: flex; align-items: center; gap: 5px; margin-top: 7px; padding-top: 7px; border-top: 1px solid var(--line); }
  .ui-tm-ft .spacer { flex: 1 1 auto; }
  .ui-tm-ft input { width: 58px; height: 24px; text-align: center; font-size: 11px; border: 1px solid var(--line-2);
    border-radius: 6px; font-family: inherit; outline: 0; font-variant-numeric: tabular-nums; }
  .ui-tm-ft input:focus { border-color: var(--blue); }

  .ui-empty { padding: 34px 10px; text-align: center; color: var(--t3); font-size: 12.5px; }
  .ui-empty b { display: block; color: var(--t1); font-size: 13px; margin-bottom: 4px; }

  .ui-role-tip { display: flex; align-items: center; gap: 8px; font-size: 11.5px; color: var(--t2); background: var(--blue-soft);
    border: 1px solid var(--blue-soft-2); border-radius: 9px; padding: 7px 11px; }
  .ui-role-tip b { color: var(--blue-ink); }
  .ui-role-tip .tag { height: 17px; }

  .ui-lock { display: inline-flex; align-items: center; gap: 3px; font-size: 10.5px; color: var(--t3); }
  .ui-lock::before { content: "🔒"; font-size: 9px; }

  /* 分页 */
  .pager .ui-pgs { display: flex; align-items: center; gap: 4px; }
  .pager .pg-jump .input { cursor: text; }
  .pager .pg-btn[disabled] { opacity: .38; pointer-events: none; }

  /* 上传面板 */
  .ui-drop { border: 1.5px dashed var(--line-3); border-radius: 12px; background: var(--surface-2); padding: 26px 18px; text-align: center;
    transition: border-color .15s, background .15s; cursor: pointer; }
  .ui-drop:hover, .ui-drop.on { border-color: var(--blue); background: var(--blue-soft); }
  .ui-drop .dt { font-size: 13px; font-weight: 600; color: var(--t1); }
  .ui-drop .ds { font-size: 11.5px; color: var(--t3); margin-top: 5px; line-height: 1.6; }
  .ui-file { display: flex; align-items: center; gap: 9px; margin-top: 10px; padding: 9px 11px; border: 1px solid var(--line-2); border-radius: 10px; background: #fff; }
  .ui-file .fi { width: 26px; height: 26px; border-radius: 7px; background: var(--blue-soft); color: var(--blue-ink); display: grid; place-items: center; font-size: 11px; font-weight: 700; }
  .ui-file .fn { font-size: 12px; font-weight: 600; color: var(--t1); }
  .ui-file .fm { font-size: 10.5px; color: var(--t3); margin-top: 2px; }
  .ui-file .fx { margin-left: auto; color: var(--t3); cursor: pointer; }
  .ui-file .fx:hover { color: var(--red); }
  .ui-map-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 10px; margin-top: 10px; }
  .ui-map-grid .m { font-size: 11.5px; }
  .ui-map-grid .m label { display: block; color: var(--t3); margin-bottom: 4px; font-size: 10.5px; }
  .ui-map-grid .m .select { width: 100%; }
  .ui-preview { margin-top: 10px; max-height: 210px; overflow: auto; border: 1px solid var(--line); border-radius: 9px; }

  /* 悬浮明细卡（柱条 / 行的详细数据） */
  .ui-tip { position: fixed; z-index: 9400; max-width: 300px; background: #fff; border: 1px solid var(--line-2);
    border-radius: 10px; box-shadow: 0 12px 30px rgba(16,24,40,.16); padding: 9px 11px; font-size: 11.5px;
    color: var(--t2); line-height: 1.65; pointer-events: none; animation: uiIn .1s ease-out; }
  .ui-tip .tt { font-size: 12px; font-weight: 650; color: var(--t1); margin-bottom: 3px; display: flex; align-items: center; gap: 6px; }
  .ui-tip .kv-row { display: flex; gap: 8px; justify-content: space-between; }
  .ui-tip .kv-row b { color: var(--t1); font-weight: 600; }
  .ui-tip .hr { height: 1px; background: var(--line); margin: 5px 0; }
  .ui-tip .dim2 { color: var(--t4); font-size: 10.5px; }
  `;
  function injectStyles() {
    if (document.getElementById('ui-styles')) return;
    const s = document.createElement('style');
    s.id = 'ui-styles';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* ---------- 1. 工具 ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  /* ---------- 2. Toast ---------- */
  let toastBox = null;
  function toast(msg, type, ms) {
    injectStyles();
    if (!toastBox) { toastBox = el('div', 'ui-toasts'); document.body.appendChild(toastBox); }
    const t = el('div', 'ui-toast ' + (type || ''), '<i></i><div class="tx">' + msg + '</div>');
    toastBox.appendChild(t);
    const kill = () => { t.classList.add('out'); setTimeout(() => t.remove(), 200); };
    t.addEventListener('click', kill);
    setTimeout(kill, ms || 2800);
    return kill;
  }
  toast.ok = m => toast(m, 'ok');
  toast.warn = m => toast(m, 'warn');
  toast.err = m => toast(m, 'err');

  /* ---------- 3. Modal / Confirm ---------- */
  function modal(opt) {
    injectStyles();
    const mask = el('div', 'ui-mask');
    const dlg = el('div', 'ui-dlg');
    if (opt.width) dlg.style.width = opt.width + 'px';
    dlg.innerHTML =
      '<div class="ui-dlg-hd"><div><div class="tt">' + esc(opt.title || '') + '</div>' +
      (opt.sub ? '<div class="st">' + opt.sub + '</div>' : '') + '</div><button class="x" aria-label="关闭">✕</button></div>' +
      '<div class="ui-dlg-bd">' + (opt.body || '') + '</div>' +
      '<div class="ui-dlg-ft">' + (opt.footLeft || '') + '<span class="spacer"></span>' +
      '<button class="btn" data-act="cancel">' + esc(opt.cancelText || '取消') + '</button>' +
      (opt.okText === null ? '' : '<button class="btn ' + (opt.danger ? 'btn-danger' : 'btn-primary') + '" data-act="ok">' + esc(opt.okText || '确定') + '</button>') +
      '</div>';
    mask.appendChild(dlg);
    document.body.appendChild(mask);
    const close = val => {
      mask.remove();
      document.removeEventListener('keydown', onKey);
      if (opt.onClose) opt.onClose(val);
    };
    const onKey = e => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', onKey);
    mask.addEventListener('click', e => { if (e.target === mask && opt.maskClose !== false) close(null); });
    dlg.querySelector('.x').onclick = () => close(null);
    dlg.querySelector('[data-act=cancel]').onclick = () => {
      /* onCancel 可拦截「取消」做副作用（如链式打开另一个弹窗），返回 false 则不关闭 */
      if (opt.onCancel && opt.onCancel() === false) return;
      close(null);
    };
    const okBtn = dlg.querySelector('[data-act=ok]');
    if (okBtn) okBtn.onclick = () => { const r = opt.onOk ? opt.onOk(dlg, close) : true; if (r !== false) close(r === undefined ? true : r); };
    if (opt.onMount) opt.onMount(dlg, close);
    const first = dlg.querySelector('textarea, input[type=text]');
    if (first) setTimeout(() => first.focus(), 60);
    return { close, dlg, mask };
  }

  function confirm(opt) {
    return new Promise(resolve => {
      let done = false;
      modal({
        title: opt.title || '请确认',
        sub: opt.sub,
        body: opt.body || '',
        okText: opt.okText || '确定',
        cancelText: opt.cancelText || '取消',
        danger: opt.danger,
        width: opt.width,
        // 透传调用方 onOk：返回 false 可阻止关闭（校验未通过时用）
        onOk: (dlg, close) => (opt.onOk ? opt.onOk(dlg, close) : true),
        onClose: v => { if (done) return; done = true; resolve(!!v); }
      });
    });
  }

  /* ---------- 4. 真下拉（替换 .select 伪下拉） ---------- */
  let openPop = null;
  function closePop() { if (openPop) { openPop.remove(); openPop = null; } }
  document.addEventListener('click', e => {
    if (openPop && !openPop.contains(e.target) && !e.target.closest('.ui-sel')) closePop();
  });
  window.addEventListener('resize', closePop);
  window.addEventListener('scroll', e => { if (openPop && openPop.contains(e.target)) return; closePop(); }, true);

  /**
   * 把一个 .select 元素变成可交互下拉
   * @param {Element} node 目标 .select 元素
   * @param {{items:Array, value:any, onChange:Function, label:Function}} opt
   */
  const CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" ' +
    'stroke-linecap="round" stroke-linejoin="round"><path d="M6 9.5l6 6 6-6"/></svg>';

  function select(node, opt) {
    injectStyles();
    if (!node) return;
    node.classList.add('ui-sel');
    node.dataset.role = 'select';
    /* 没有自带箭头时补一个，避免下拉与文本输入框视觉上无法区分 */
    if (!node.querySelector('svg')) node.insertAdjacentHTML('beforeend', CHEV);
    const items = opt.items || [];
    let value = opt.value != null ? opt.value : (items[0] && (items[0].v != null ? items[0].v : items[0]));
    const labelOf = v => {
      const hit = items.find(i => (i.v != null ? i.v : i) === v);
      const raw = hit ? (hit.t != null ? hit.t : hit) : v;
      return opt.label ? opt.label(raw) : raw;
    };
    function paint() {
      const keepIcon = node.querySelector('svg');
      const empty = (value === '' || value == null);
      /* placeholder：未选中时显示提示文案（如「请选择所在单位」），并置灰 */
      node.classList.toggle('is-empty', !!(empty && opt.placeholder));
      const txt = (empty && opt.placeholder) ? esc(opt.placeholder) : esc(labelOf(value));
      node.innerHTML = txt + (opt.suffix && !empty ? '<span class="cnt">' + esc(opt.suffix(value)) + '</span>' : '');
      if (keepIcon) node.appendChild(keepIcon);
    }
    paint();
    node.onclick = ev => {
      ev.stopPropagation();
      if (openPop && openPop.dataset.owner === node.dataset.uid) { closePop(); return; }
      closePop();
      const pop = el('div', 'ui-pop');
      node.dataset.uid = node.dataset.uid || 's' + Math.random().toString(36).slice(2, 7);
      pop.dataset.owner = node.dataset.uid;
      let lastGroup = null;
      items.forEach(i => {
        const v = i.v != null ? i.v : i;
        const t = i.t != null ? i.t : i;
        /* 分组标题：items 里带 g 字段时按组渲染（如「单位」下拉的 区级部门 / 街镇） */
        if (i.g && i.g !== lastGroup) {
          pop.appendChild(el('div', 'grp', esc(i.g)));
          lastGroup = i.g;
        }
        const op = el('div', 'op' + (v === value ? ' on' : ''),
          esc(t) + (v === value ? '<span class="ck">✓</span>' : (i.cnt != null ? '<span class="cnt">' + i.cnt + '</span>' : '')));
        op.onclick = () => {
          value = v; paint(); closePop();
          if (opt.onChange) opt.onChange(v, node);
        };
        pop.appendChild(op);
      });
      document.body.appendChild(pop);
      const r = node.getBoundingClientRect();
      pop.style.minWidth = Math.max(r.width, 132) + 'px';
      const ph = pop.offsetHeight;
      let top = r.bottom + 4;
      if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 4);
      pop.style.top = top + 'px';
      pop.style.left = Math.min(Math.max(8, r.left), window.innerWidth - pop.offsetWidth - 8) + 'px';
      openPop = pop;
    };
    node.style.cursor = 'pointer';
    return {
      get value() { return value; },
      set(v) { value = v; paint(); },
      items: items
    };
  }

  /* ---------- 4b. 日期 / 时间选择器 ---------- */
  const pad2 = n => (n < 10 ? '0' : '') + n;
  function isoOf(y, m, d) { return y + '-' + pad2(m) + '-' + pad2(d); }
  function todayISO() { const d = new Date(); return isoOf(d.getFullYear(), d.getMonth() + 1, d.getDate()); }
  function nowHM() { const d = new Date(); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }

  /* 浮层统一挂载 + 定位（复用 .ui-pop 的外部点击关闭机制） */
  function openPanel(node, cls, build) {
    if (openPop && openPop.dataset.owner === node.dataset.uid) { closePop(); return null; }
    closePop();
    node.dataset.uid = node.dataset.uid || 'p' + Math.random().toString(36).slice(2, 7);
    const pop = el('div', 'ui-pop ' + cls);
    pop.dataset.owner = node.dataset.uid;
    build(pop);
    document.body.appendChild(pop);
    const r = node.getBoundingClientRect();
    let top = r.bottom + 4;
    if (top + pop.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - pop.offsetHeight - 4);
    pop.style.top = top + 'px';
    pop.style.left = Math.min(Math.max(8, r.left), window.innerWidth - pop.offsetWidth - 8) + 'px';
    openPop = pop;
    return pop;
  }

  /**
   * 日历选择器：把一个 input 变成只读 + 点击弹日历，选中后写回 input.value
   * @param {HTMLInputElement} node
   * @param {{value?:string, onChange?:Function, min?:string, max?:string}} opt
   */
  function datePicker(node, opt) {
    injectStyles();
    if (!node) return null;
    opt = opt || {};
    let value = opt.value != null ? opt.value : (node.value || '');
    node.readOnly = true;
    node.setAttribute('autocomplete', 'off');
    node.classList.add('ui-dt');
    node.value = value;

    const commit = v => {
      value = v || '';
      node.value = value;
      if (opt.onChange) opt.onChange(value, node);
    };

    function open(view) {
      const base = value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split('-') : todayISO().split('-');
      const st = view || { y: +base[0], m: +base[1] };
      openPanel(node, 'ui-cal', pop => {
        function render() {
          const y = st.y, m = st.m;
          const startWd = new Date(y, m - 1, 1).getDay();
          const daysIn = new Date(y, m, 0).getDate();
          const prevDays = new Date(y, m - 1, 0).getDate();
          const cells = [];
          for (let i = startWd - 1; i >= 0; i--) cells.push({ d: prevDays - i, mut: true });
          for (let d = 1; d <= daysIn; d++) cells.push({ d, mut: false });
          while (cells.length % 7) cells.push({ d: cells.length - startWd - daysIn + 1, mut: true });
          const tdy = todayISO();
          pop.innerHTML =
            `<div class="ui-cal-hd">
               <button class="mv" data-mv="-12" title="上一年">«</button>
               <button class="mv" data-mv="-1" title="上个月">‹</button>
               <span class="m">${y} 年 ${pad2(m)} 月</span>
               <button class="mv" data-mv="1" title="下个月">›</button>
               <button class="mv" data-mv="12" title="下一年">»</button>
             </div>
             <div class="ui-cal-wd">${['日', '一', '二', '三', '四', '五', '六'].map(w => '<span>' + w + '</span>').join('')}</div>
             <div class="ui-cal-gd">${cells.map(c => {
               if (c.mut) return `<span class="mut">${c.d}</span>`;
               const iso = isoOf(y, m, c.d);
               const cls = (iso === value ? 'on' : '') + (iso === tdy ? ' tdy' : '');
               return `<span class="${cls}" data-d="${iso}">${c.d}</span>`;
             }).join('')}</div>
             <div class="ui-cal-ft">
               <button class="btn btn-sm" data-today>今天</button>
               <button class="btn btn-sm" data-clear>清空</button>
               <span class="spacer"></span>
               <button class="btn btn-sm" data-close>关闭</button>
             </div>`;
          pop.querySelectorAll('[data-mv]').forEach(b => {
            b.onclick = ev => {
              ev.stopPropagation();
              const step = +b.dataset.mv;
              let nm = st.m + step, ny = st.y;
              while (nm > 12) { nm -= 12; ny++; }
              while (nm < 1) { nm += 12; ny--; }
              st.y = ny; st.m = nm;
              render();
            };
          });
          pop.querySelectorAll('[data-d]').forEach(s => {
            s.onclick = ev => {
              ev.stopPropagation();
              commit(s.dataset.d);
              closePop();
            };
          });
          const q = sel => pop.querySelector(sel);
          q('[data-today]').onclick = ev => { ev.stopPropagation(); commit(todayISO()); closePop(); };
          q('[data-clear]').onclick = ev => { ev.stopPropagation(); commit(''); closePop(); };
          q('[data-close]').onclick = ev => { ev.stopPropagation(); closePop(); };
        }
        render();
      });
    }
    node.onclick = ev => { ev.stopPropagation(); open(); };
    return {
      get value() { return value; },
      set(v) { value = v || ''; node.value = value; },
      open: () => open()
    };
  }

  /**
   * 时间选择器：小时列 + 分钟列（5 分钟步进）+ 精确到分的输入
   * @param {HTMLInputElement} node
   * @param {{value?:string, onChange?:Function, step?:number, presets?:Array<string>}} opt
   */
  function timePicker(node, opt) {
    injectStyles();
    if (!node) return null;
    opt = opt || {};
    const step = opt.step || 5;
    let value = opt.value != null ? opt.value : (node.value || '');
    node.readOnly = true;
    node.setAttribute('autocomplete', 'off');
    node.classList.add('ui-tm-in');
    node.value = value;

    const commit = v => {
      value = v || '';
      node.value = value;
      if (opt.onChange) opt.onChange(value, node);
    };

    function open() {
      const cur = /^\d{2}:\d{2}$/.test(value) ? value.split(':') : nowHM().split(':');
      let hh = +cur[0], mi = +cur[1];
      openPanel(node, 'ui-tm', pop => {
        function render() {
          const hours = [];
          for (let i = 0; i < 24; i++) hours.push(pad2(i));
          const mins = [];
          for (let i = 0; i < 60; i += step) mins.push(pad2(i));
          pop.innerHTML =
            `<div class="ui-tm-bd">
               <div class="ui-tm-col"><b>时</b>${hours.map(v => `<span class="${+v === hh ? 'on' : ''}" data-h="${v}">${v}</span>`).join('')}</div>
               <div class="ui-tm-col"><b>分</b>${mins.map(v => `<span class="${+v === mi ? 'on' : ''}" data-m="${v}">${v}</span>`).join('')}</div>
             </div>
             <div class="ui-tm-ft">
               <span class="tiny dim">精确</span>
               <input data-exact value="${pad2(hh)}:${pad2(mi)}" maxlength="5">
               <span class="spacer"></span>
               <button class="btn btn-sm" data-now>此刻</button>
             </div>`;
          const paint = () => {
            pop.querySelectorAll('[data-h]').forEach(s => s.classList.toggle('on', +s.dataset.h === hh));
            pop.querySelectorAll('[data-m]').forEach(s => s.classList.toggle('on', +s.dataset.m === mi));
            const ex = pop.querySelector('[data-exact]');
            if (ex && document.activeElement !== ex) ex.value = pad2(hh) + ':' + pad2(mi);
          };
          pop.querySelectorAll('[data-h]').forEach(s => {
            s.onclick = ev => { ev.stopPropagation(); hh = +s.dataset.h; paint(); commit(pad2(hh) + ':' + pad2(mi)); };
          });
          pop.querySelectorAll('[data-m]').forEach(s => {
            s.onclick = ev => { ev.stopPropagation(); mi = +s.dataset.m; paint(); commit(pad2(hh) + ':' + pad2(mi)); };
          });
          pop.querySelector('[data-now]').onclick = ev => {
            ev.stopPropagation();
            const t = nowHM().split(':');
            hh = +t[0]; mi = +t[1];
            paint(); commit(pad2(hh) + ':' + pad2(mi)); closePop();
          };
          const ex = pop.querySelector('[data-exact]');
          ex.onclick = ev => ev.stopPropagation();
          ex.onkeydown = ev => { if (ev.key === 'Enter') ex.blur(); };
          ex.onblur = () => {
            const m = /^(\d{1,2}):(\d{1,2})$/.exec(ex.value.trim());
            if (!m) { ex.value = pad2(hh) + ':' + pad2(mi); return; }
            const h2 = Math.min(23, +m[1]), m2 = Math.min(59, +m[2]);
            hh = h2; mi = m2;
            paint(); commit(pad2(hh) + ':' + pad2(mi));
          };
        }
        render();
      });
    }
    node.onclick = ev => { ev.stopPropagation(); open(); };
    return {
      get value() { return value; },
      set(v) { value = v || ''; node.value = value; },
      open: () => open()
    };
  }

  /* ---------- 5. Checkbox / Seg / Chips ---------- */
  function check(node, opt) {
    if (!node) return;
    const onChange = (opt && opt.onChange) || null;
    node.style.cursor = 'pointer';
    node.onclick = ev => {
      ev.stopPropagation();
      const on = !node.classList.contains('on');
      node.classList.toggle('on', on);
      if (onChange) onChange(on, node);
    };
    return { get on() { return node.classList.contains('on'); }, set(v) { node.classList.toggle('on', !!v); } };
  }

  function seg(root, opt) {
    if (!root) return;
    const btns = $$('button', root);
    const onChange = opt && opt.onChange;
    btns.forEach(b => {
      b.onclick = () => {
        if (b.classList.contains('on') && !(opt && opt.repeat)) return;
        btns.forEach(x => x.classList.toggle('on', x === b));
        if (onChange) onChange(b.dataset.v != null ? b.dataset.v : b.textContent.trim(), b, btns.indexOf(b));
      };
    });
    return {
      set(i) { btns.forEach((x, k) => x.classList.toggle('on', k === i)); },
      get index() { return btns.findIndex(x => x.classList.contains('on')); }
    };
  }

  function chips(root, opt) {
    if (!root) return;
    const nodes = $$('.chip-select', root);
    const onChange = opt && opt.onChange;
    nodes.forEach(n => {
      n.style.cursor = 'pointer';
      n.onclick = () => {
        n.classList.toggle('on');
        if (onChange) onChange(values(), n);
      };
    });
    function values() { return nodes.filter(n => n.classList.contains('on')).map(n => n.dataset.v || n.textContent.trim()); }
    return { values, clear() { nodes.forEach(n => n.classList.remove('on')); } };
  }

  /* ---------- 6. 分页 ---------- */
  /**
   * 渲染分页到指定容器（保留原型 .pager / .pg-btn / .pg-jump 样式）
   * @param {Element} node .pager 容器
   * @param {{total:number, page:number, size:number, onChange:Function, unit:string}} opt
   */
  function pager(node, opt) {
    if (!node) return null;
    const total = opt.total, size = opt.size || 20;
    const pages = Math.max(1, Math.ceil(total / size));
    let page = Math.min(Math.max(1, opt.page || 1), pages);
    const unit = opt.unit || '条';

    function render() {
      const nums = [];
      const push = n => { if (n >= 1 && n <= pages && nums.indexOf(n) < 0) nums.push(n); };
      if (pages <= 7) { for (let i = 1; i <= pages; i++) push(i); }
      else {
        push(1); push(2);
        if (page > 4) nums.push('…');
        for (let i = page - 1; i <= page + 1; i++) push(i);
        if (page < pages - 3) nums.push('…');
        push(pages - 1); push(pages);
      }
      node.innerHTML =
        '<span>共 <b style="color:var(--t1)">' + total + '</b> ' + unit + ' · 第 ' + page + ' / ' + pages + ' 页</span>' +
        '<span class="spacer"></span>' +
        '<div class="ui-pgs">' +
        '<button class="pg-btn" data-p="' + (page - 1) + '" ' + (page === 1 ? 'disabled' : '') + '>‹</button>' +
        nums.map(n => n === '…' ? '<span class="dim" style="padding:0 2px">…</span>'
          : '<button class="pg-btn ' + (n === page ? 'on' : '') + '" data-p="' + n + '">' + n + '</button>').join('') +
        '<button class="pg-btn" data-p="' + (page + 1) + '" ' + (page === pages ? 'disabled' : '') + '>›</button>' +
        '</div>' +
        '<span class="pg-jump">前往 <span class="input" contenteditable="true" data-jump>' + page + '</span> 页</span>';

      node.querySelectorAll('[data-p]').forEach(b => {
        b.onclick = () => go(Number(b.dataset.p));
      });
      const jump = node.querySelector('[data-jump]');
      if (jump) {
        jump.addEventListener('keydown', e => {
          if (e.key === 'Enter') { e.preventDefault(); go(Number(jump.textContent.trim())); }
        });
        jump.addEventListener('blur', () => { go(Number(jump.textContent.trim())); });
      }
    }
    function go(p) {
      const target = Math.min(Math.max(1, isNaN(p) ? 1 : p), pages);
      if (target === page) { render(); return; }
      page = target;
      render();
      if (opt.onChange) opt.onChange(page, size);
    }
    render();
    return { get page() { return page; }, go, pages, setTotal(t) { opt.total = t; render(); } };
  }

  /* ---------- 7. 表头排序 ---------- */
  function sortTable(table, opt) {
    if (!table) return;
    const tbody = table.tBodies[0];
    const opt2 = opt || {};
    $$('th', table.tHead).forEach((th, idx) => {
      if (th.dataset.nosort != null) return;
      th.style.cursor = 'pointer';
      th.title = '点击排序';
      let dir = 0;
      th.onclick = () => {
        dir = dir === 0 ? 1 : (dir === 1 ? -1 : 1);
        $$('th', table.tHead).forEach(x => { if (x !== th) { x.dataset.dir = ''; x.classList.remove('sort-asc', 'sort-desc'); } });
        th.dataset.dir = dir === 1 ? 'asc' : 'desc';
        th.classList.toggle('sort-asc', dir === 1);
        th.classList.toggle('sort-desc', dir === -1);
        const rows = $$('tr', tbody);
        const val = tr => {
          const cell = tr.children[idx];
          if (!cell) return '';
          const raw = cell.dataset.v != null ? cell.dataset.v : cell.textContent.trim();
          const num = parseFloat(String(raw).replace(/[^\d.\-]/g, ''));
          return isNaN(num) ? String(raw) : num;
        };
        rows.sort((a, b) => {
          const va = val(a), vb = val(b);
          if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
          return String(va).localeCompare(String(vb), 'zh-CN') * dir;
        });
        rows.forEach(r => tbody.appendChild(r));
        if (opt2.onSort) opt2.onSort(idx, dir);
      };
    });
  }

  /* ---------- 7b. 悬浮明细（柱条 / 行的详细数据） ---------- */
  let tipEl = null;
  function tipClose() { if (tipEl) { tipEl.remove(); tipEl = null; } }
  /**
   * 给元素挂悬浮明细卡
   * @param {Element} node 触发元素
   * @param {Function|string} content 返回 HTML 的函数或字符串
   */
  function tip(node, content) {
    if (!node) return;
    injectStyles();
    const show = () => {
      tipClose();
      tipEl = el('div', 'ui-tip');
      tipEl.innerHTML = typeof content === 'function' ? content() : content;
      document.body.appendChild(tipEl);
      const r = node.getBoundingClientRect();
      const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
      tipEl.style.left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8) + 'px';
      let top = r.top - h - 8;
      if (top < 8) top = Math.min(window.innerHeight - h - 8, r.bottom + 8);
      tipEl.style.top = top + 'px';
    };
    node.addEventListener('mouseenter', show);
    node.addEventListener('mouseleave', tipClose);
    node.addEventListener('mousedown', tipClose);
  }
  window.addEventListener('scroll', tipClose, true);

  /* ---------- 8. 字段渲染（按角色明暗） ---------- */  function field(roleKey, name, person, opt) {
    const f = window.DATA.field(roleKey, name, person);
    const withLock = opt && opt.lock && f.masked;
    if (name === 'idNo') {
      return '<span class="mask' + (f.masked ? '' : '') + '">' + esc(f.text) + '</span>' + (withLock ? '<span class="ui-lock">掩码</span>' : '');
    }
    if (name === 'name') return esc(f.text);
    return esc(f.text) + (withLock ? ' <span class="ui-lock">掩码</span>' : '');
  }

  /* ---------- 9. CSV 导出（真实文件下载） ---------- */
  function downloadCSV(filename, rows, opt) {
    const o = opt || {};
    const bom = o.bom === false ? '' : '\ufeff';
    const body = rows.map(r => r.map(c => {
      const s = c == null ? '' : String(c);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',')).join('\r\n');
    const blob = new Blob([bom + body], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  }

  /* ---------- 10. 空态 ---------- */
  function empty(title, desc) {
    return '<div class="ui-empty"><b>' + esc(title) + '</b>' + (desc ? esc(desc) : '') + '</div>';
  }

  /* ---------- 11. 角色提示条 ---------- */
  function roleTip() {
    const r = window.STORE.role();
    const mask = r.fields.idNo === 'mask';
    return '<div class="ui-role-tip"><span class="tag tag-blue" style="height:17px">' + esc(r.roleName) + '</span>' +
      '<span>数据范围 <b>' + (r.scope === 'dept' ? '仅 ' + esc(r.dept) : '全区') + '</b> · 身份证 <b>' + (mask ? '掩码' : '明文') + '</b>' +
      (mask ? ' · 查看明文需申请并留痕' : ' · 全字段可见且留痕') + '</span></div>';
  }

  injectStyles();

  return {
    esc, $, $$, el, toast, modal, confirm,
    select, datePicker, timePicker, check, seg, chips, pager, sortTable, tip,
    field, downloadCSV, empty, roleTip, injectStyles, todayISO, nowHM
  };
})();
