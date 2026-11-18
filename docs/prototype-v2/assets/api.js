/* ============================================================
   api.js · B5 服务端数据接入（只读快照）
   ------------------------------------------------------------
   目的：让演示前端能切到真实链路（FastAPI + PostgreSQL），
        而**页面代码一行不改** —— 靠 data.js 的 hydrate() 就地替换数据本体。
   四条不变量（改之前先读）：
   1. **默认 mock**：不加 ?live=1 时，行为与 B5 之前完全一致，演示零风险；
   2. **同构**：hydrate 后的对象与本地生成物同形（字段名、类型、单位都一样），
      页面里不许出现 if (live) 这类分叉，否则口径迟早分裂；
   3. **降级可见**：服务端不可达不静默回落，登录页与顶栏都要能看见当前数据源；
   4. **快照先行**：快照落 sessionStorage，脚本解析期同步读出来注入，
      这样首屏渲染前数据就已就位，不需要把 14 个页面改成异步引导。
   依赖：data.js（必须先加载）→ 本文件 → store.js
   ============================================================ */
window.API = (function () {
  'use strict';

  const K = 'miyun-v2';
  const SNAP = K + ':snap';       // 服务端快照（sessionStorage，按标签页隔离）
  const TOK = K + ':token';       // Bearer 令牌
  const LIVE = K + ':live';       // 数据源开关：'1' = 服务端
  const BASE = K + ':base';       // API 根地址（换环境不改代码）
  const OFF = K + ':offline';     // 上次同步失败标记
  const BOOT = K + ':boot';       // 首屏只重载一次的护栏

  const qs = new URLSearchParams(location.search);
  const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* 隐私模式 */ } };
  const ssGet = k => { try { return sessionStorage.getItem(k); } catch (e) { return null; } };
  const ssSet = (k, v) => { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch (e) { /* 隐私模式 */ } };

  /* ---- 数据源开关：?live=1/0 显式覆盖，其余沿用上次选择 ---- */
  if (qs.get('live') === '1') lsSet(LIVE, '1');
  if (qs.get('live') === '0') { lsSet(LIVE, null); lsSet(TOK, null); }
  if (qs.get('api')) lsSet(BASE, qs.get('api'));

  const base = () => (lsGet(BASE) || 'http://127.0.0.1:8001/api').replace(/\/+$/, '');
  const token = () => lsGet(TOK);
  const enabled = () => lsGet(LIVE) === '1';

  let snap = null;        // 已注入的快照
  let offline = lsGet(OFF) === '1';
  let lastError = '';
  let booting = false;

  /* ---------- 传输 ---------- */
  function req(method, path, body) {
    const url = base() + path;
    const headers = { 'Content-Type': 'application/json' };
    const t = token();
    if (t) headers.Authorization = 'Bearer ' + t;
    return fetch(url, {
      method, headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    }).then(res => {
      return res.text().then(txt => {
        let data = null;
        try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = txt; }
        if (!res.ok) {
          const d = (data && data.detail) || {};
          const err = new Error(typeof d === 'string' ? d : (d.reason || ('HTTP ' + res.status)));
          err.code = (typeof d === 'object' && d.code) || String(res.status);
          err.status = res.status;
          err.data = data;
          if (res.status === 401) lsSet(TOK, null);   // 令牌失效即清，避免每页都 401
          throw err;
        }
        return data;
      });
    }).catch(e => {
      if (e.code) throw e;
      const err = new Error('服务端不可达（' + base() + '）');
      err.code = 'network';
      throw err;
    });
  }

  function paged(path) {
    const out = [];
    let page = 1;
    const step = () => req('GET', path + (path.indexOf('?') > -1 ? '&' : '?') + 'page=' + page + '&size=200')
      .then(d => {
        const items = (d && d.items) || [];
        items.forEach(x => out.push(x));
        const total = (d && d.total) || 0;
        if (!items.length || out.length >= total || page >= 40) return out;
        page += 1;
        return step();
      });
    return step();
  }

  /* ---------- 快照：拉一次、缓存、注入 ---------- */
  function sync() {
    if (!token()) return Promise.reject(Object.assign(new Error('未登录'), { code: 'no_token' }));
    return Promise.all([
      req('GET', '/me'),
      req('GET', '/stats/overview'),
      paged('/persons'),
      paged('/level-changes'),
      paged('/alerts')
    ]).then(([me, stats, persons, changes, alerts]) => {
      const s = {
        v: 1,
        at: new Date().toISOString(),
        base: base(),
        district: me.district,
        user: me.user,
        stats, persons, changes, alerts
      };
      ssSet(SNAP, JSON.stringify(s));
      offline = false; lsSet(OFF, null); lastError = '';
      apply(s);
      return s;
    }).catch(err => {
      offline = true; lsSet(OFF, '1');
      lastError = err.message || String(err);
      throw err;
    });
  }

  function apply(s) {
    snap = s;
    if (!window.DATA || typeof DATA.hydrate !== 'function') return false;
    try { return !!DATA.hydrate(s); } catch (e) {
      console.error('[api] hydrate 失败，回落本地演示数据', e);
      lastError = '数据注入失败：' + e.message;
      snap = null;
      return false;
    }
  }

  function readSnap() {
    try {
      const s = JSON.parse(ssGet(SNAP) || 'null');
      if (!s || s.v !== 1 || s.base !== base()) return null;   // 换环境后旧快照作废
      return s;
    } catch (e) { return null; }
  }

  /* ---------- 登录 / 登出 ---------- */
  function login(account, password) {
    return req('POST', '/auth/login', password ? { account, password } : { account })
      .then(d => {
        lsSet(TOK, d.token);
        lsSet(LIVE, '1');
        ssSet(BOOT, null);
        ssSet(SNAP, null);
        return sync().then(() => d.user);
      });
  }

  function logout() {
    lsSet(TOK, null); lsSet(LIVE, null);
    ssSet(SNAP, null); ssSet(BOOT, null);
    snap = null;
  }

  /* ---------- 写回（B5 只做 best-effort：本地先生效，服务端留痕） ---------- */
  /* 状态词表不同：前端处置终态是「已闭环」，服务端是「已处置 / 已忽略 / 转派」 */
  const DISPOSE = { '已闭环': '已处置', '已处置': '已处置', '已忽略': '已忽略' };

  /* 四个写入口第一个动作都是 live() 判断：
     否则调用方 API.fire(API.disposeAlert(...)) 里「取参数」就会先把请求发出去，
     mock 模式凭空产生网络流量（回归脚本 check-live-write 就是抓这个）。 */
  function disposeAlert(id, status, note) {
    const to = DISPOSE[status];
    if (!live() || !to) return Promise.resolve(null);   // 处置中 / 待处置 不是终态，不落库
    return req('POST', '/alerts/' + encodeURIComponent(id) + '/dispose', { status: to, note: note || null });
  }
  function transferAlert(id, to, note) {
    if (!live()) return Promise.resolve(null);
    return req('POST', '/alerts/' + encodeURIComponent(id) + '/dispose',
      { status: '转派', to: to, note: note || null });
  }
  function createChange(body) {
    if (!live()) return Promise.resolve(null);
    return req('POST', '/level-changes', body);
  }
  function createVisit(pid, body) {
    if (!live()) return Promise.resolve(null);
    return req('POST', '/persons/' + encodeURIComponent(pid) + '/visits', body);
  }

  /* 写回失败不该打断演示：提示一句并标记离线，页面继续用本地数据 */
  function fire(promise, label) {
    if (!live()) return;
    promise.catch(err => {
      offline = true; lsSet(OFF, '1'); lastError = err.message || String(err);
      if (window.UI && UI.toast && UI.toast.warn) UI.toast.warn('服务端写回失败（' + label + '）：' + lastError);
      console.warn('[api] 写回失败', label, err);
    });
  }

  /* ---------- 对外状态 ---------- */
  /* live = 服务端数据真的注入了 DOM 数据源；enabled 只是开关，可能因断网没注进去 */
  function live() { return enabled() && !!snap; }
  function status() {
    const u = snap && snap.user;
    return {
      enabled: enabled(), live: live(), offline: offline,
      base: base(), at: (snap && snap.at) || null,
      user: u ? { name: u.name, account: u.account, roleKey: u.roleKey, roleName: u.roleName, unit: u.unit } : null,
      error: lastError
    };
  }
  /* 权限位（服务端 role_perm 表）：未登录或 mock 时返回 null，调用方回落到本地 can() */
  function can(code) {
    const u = snap && snap.user;
    if (!u || !u.perms) return null;
    return u.perms.indexOf(code) > -1;
  }

  /* ---------- 启动 ---------- */
  if (enabled()) {
    const cached = readSnap();
    if (cached) apply(cached);
    else {
      /* 首屏没快照：先拉一次再重载（护栏只放行一次，避免断网时无限刷新） */
      const guard = ssGet(BOOT);
      const start = () => {
        if (guard === '1' || booting) { offline = true; lsSet(OFF, '1'); return; }
        booting = true; ssSet(BOOT, '1');
        sync().then(() => location.reload()).catch(err => {
          offline = true; lsSet(OFF, '1'); lastError = err.message || String(err);
          console.warn('[api] 首次同步失败，停在本地演示数据', err);
        });
      };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
      else start();
    }
  }
  /* ?refresh=1：强制重新同步一次（改了库里的数据不用清浏览器缓存） */
  if (qs.get('refresh') === '1' && token()) {
    const run = () => sync().then(() => {
      const u = new URL(location.href); u.searchParams.delete('refresh');
      location.replace(u.toString());
    }).catch(err => console.warn('[api] 刷新失败', err));
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
    else run();
  }

  return {
    enabled, live, status, can, login, logout, sync, apply,
    disposeAlert, transferAlert, createChange, createVisit, fire,
    base, token, snapshot: () => snap
  };
})();
