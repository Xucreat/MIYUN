/* B5 真链路端到端：真实浏览器 + 真实 HTTP + 真实 PostgreSQL
   ------------------------------------------------------------
   和另外两个脚本的分工：
     · check-live-role.js / smoke-b5.js：离浏览器网络，用快照验「映射与渲染」；
     · 本脚本：真登录（/api/auth/login 签发令牌）→ 真拉快照 → 真写库（预警处置落 alert + audit_log）。
   前置：backend 的 PG(55433) 与 API(8001) 已启动；静态站 8081。
   用法：node tools/check-live-e2e.js
   注意：本脚本会真的改库（处置一条预警、登记一次等级变动与走访），跑完请执行 `python -m app.seed` 还原。
   ⚠ 前置（2026-11-18 起强制校验）：库必须是种子态，否则第 1b 步打印实际值并以 exit 2 中止。
     本脚本真写库（处置预警 / 登记等级变动 / 登记走访），**跑完必须** `cd backend && python -m app.seed` 还原。
     不还原就连跑，会累积 level_change 与 visit 行，或撞上服务端 `level_unchanged`（400，目标等级=当前等级）——
     后者是正确校验，不是缺陷。
   ✅ 环境（2026-11-18 复测）：此前记录的「Chrome 渲染进程请求 8001 即崩」已不复现，
     分层探针（直访 /api/health、8081 页面内 fetch、localhost 变体、纯静态 8002）五项全通，本脚本可正常跑完。
*/
const PW = 'C:/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2-6/node_modules/@playwright/cli/node_modules/playwright-core';
const { chromium } = require(PW);

const WEB = process.env.BASE || 'http://127.0.0.1:8081';
const API = process.env.API || 'http://127.0.0.1:8001/api';
const PAGES = ['dashboard', 'board', 'bigscreen', 'persons', 'person', 'alerts', 'blind',
  'risk', 'wartime', 'analytics', 'import', 'system'];

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e && e.message || e)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  let fail = 0;
  const ok = (c, m) => { if (!c) fail++; console.log(`  ${c ? 'PASS' : 'FAIL'} ${m}`); };

  /* ---- 1. 真登录 ---- */
  console.log('=== 真登录（/api/auth/login → 令牌 → 快照）===');
  await page.goto(WEB + '/login.html', { waitUntil: 'load' });
  await page.click('.src-tab[data-src="live"]');
  const hint = await page.textContent('#srcHint');
  ok(/8001\/api/.test(hint || ''), '登录页提示了服务端地址：' + String(hint || '').replace(/\s+/g, ' ').slice(0, 80));
  await page.click('#btnLogin');
  await page.waitForURL(/dashboard\.html/, { timeout: 25000 });
  await page.waitForTimeout(500);

  const st = await page.evaluate(() => ({
    api: API.status(), live: !!DATA.live(), role: STORE.role(),
    rated: DATA.persons.length, unrated: DATA.unrated.length,
    stats: DATA.stats, text: document.body.innerText.replace(/\s+/g, ' '),
    token: (localStorage.getItem('miyun-v2:token') || '').slice(0, 12)
  }));
  ok(st.api.live === true, `数据源已切服务端（live=${st.api.live}, offline=${st.api.offline}）`);
  ok(!!st.live, 'DATA.live() 有注入来源（含 base 与用户）');
  ok(st.token.length > 0, 'Bearer 令牌已落地 localStorage');
  ok(st.role.key === 'live' && /R2/.test(st.role.title), `身份 ${st.role.roleName} · ${st.role.title}`);
  ok(st.rated === 486 && st.unrated === 612, `明细 486 + 待核实 612（实际 ${st.rated} + ${st.unrated}）`);
  ok(st.stats.inRegister === 6028 && st.stats.highPlus === 486 && st.stats.dual === 127
    && st.stats.multi === 214 && st.stats.unknown === 612,
    `五个核心数 ${st.stats.inRegister}/${st.stats.highPlus}/${st.stats.dual}/${st.stats.multi}/${st.stats.unknown}`);
  ok(st.text.indexOf('6,028') > -1, '驾驶舱文案含「6,028」');
  ok(st.text.indexOf('服务端') > -1, '顶栏显示服务端数据源标识');

  /* ---- 1b. 前置：库必须是种子态（本脚本真写库，不还原就反复跑会累积，断言随即误报） ---- */
  const pre = await page.evaluate(() => ({
    changes: STORE.changes().length,
    visitP0433: DATA.visitsOf(DATA.personById('P0433')).length
  }));
  if (pre.changes !== 46 || pre.visitP0433 !== 6) {
    console.log('\n===== 前置不满足：库不是种子态，本脚本中止（未写库）=====');
    console.log(`  level_change=${pre.changes}（应为 46）· P0433 走访=${pre.visitP0433}（应为 6）`);
    console.log('  上一次跑完没还原。先执行：cd backend && python -m app.seed');
    await ctx.close();
    await browser.close();
    process.exit(2);
  }
  console.log('  [前置] 库为种子态（level_change=46 · P0433 走访=6）');

  /* ---- 2. 全站走一遍：不许有 pageerror ---- */
  console.log('\n=== 真链路全站 ===');
  for (const n of PAGES) {
    errors.length = 0;
    const r = await page.goto(WEB + '/' + n + '.html', { waitUntil: 'load' });
    await page.waitForTimeout(300);
    ok(r && r.status() === 200 && !errors.length,
      `${n.padEnd(10)} http=${r ? r.status() : 0} pageerror=${errors.length}`
      + (errors.length ? ' → ' + errors[0].slice(0, 160) : ''));
  }

  /* ---- 3. 真写库：处置一条预警，再从接口把结果读回来 ---- */
  console.log('\n=== 真写库（预警处置 → alert + audit_log）===');
  errors.length = 0;
  await page.goto(WEB + '/alerts.html', { waitUntil: 'load' });
  await page.waitForTimeout(300);
  const NOTE = 'E2E 服务端落库验证';
  await page.evaluate(note => STORE.handleAlert('AL-20261110-020', '已闭环', note), NOTE);
  await page.waitForTimeout(900);

  const after = await page.evaluate(async () => {
    const t = localStorage.getItem('miyun-v2:token');
    const get = async p => (await fetch('http://127.0.0.1:8001/api' + p, { headers: { Authorization: 'Bearer ' + t } })).json();
    const al = await get('/alerts?size=200');
    const au = await get('/audit?limit=10');       // R2 没有 sys:audit:view，403 属预期
    const row = (al.items || []).find(x => x.id === 'AL-20261110-020');
    return {
      status: row ? row.status : null,
      auditForbidden: !!(au.detail && au.detail.code === 'forbidden'),
      audit: (au.items || []).find(x => x.act === '预警处置') || null,
      offline: API.status().offline
    };
  });
  ok(after.status === '已处置', `库里该预警状态 = ${after.status}（前端「已闭环」→ 服务端「已处置」）`);
  if (after.auditForbidden) {
    console.log('  SKIP 审计日志：R2 无 sys:audit:view（403 属权限生效），留痕改用 DB 侧核验：');
    console.log('       psql -c "SELECT act,detail FROM audit_log ORDER BY id DESC LIMIT 1"');
  } else {
    ok(!!after.audit, `审计日志已落库：${after.audit ? after.audit.act + ' · ' + after.audit.detail : '无'}`);
    ok(after.audit && String(after.audit.detail).indexOf(NOTE) > -1, '审计明细里带上了前端备注');
  }
  ok(after.offline === false, '写回后未被标记离线');
  /* 403 探测会被 Chrome 记成 "Failed to load resource"，那不是页面异常，过滤掉 */
  const pageErrs = errors.filter(e => e.indexOf('Failed to load resource') < 0);
  ok(pageErrs.length === 0, `写库过程零 pageerror（实际 ${pageErrs.length}${pageErrs.length ? '：' + pageErrs[0].slice(0, 120) : ''}）`);

  /* ---- 3b. 等级变动：登记 → 刷新 → 台账里不许出现两条 ---- */
  console.log('\n=== 真写库（等级变动：乐观行去重）===');
  await page.evaluate(() => STORE.addChange({
    personId: 'P0433', name: '任玉荣', town: '鼓楼街道', dept: '公安分局',
    from: 'high', to: 'high2', reason: 'E2E 定级验证'
  }));
  await page.waitForTimeout(900);
  await page.goto(WEB + '/risk.html?refresh=1', { waitUntil: 'load' });
  await page.waitForTimeout(2200);
  const chg = await page.evaluate(() => {
    const all = STORE.changes();
    const hit = all.filter(c => c.personId === 'P0433' && c.to === 'high2');
    return { hit: hit.length, ids: hit.map(c => c.id), total: all.length, live: !!API.live() };
  });
  ok(chg.live, '刷新后仍是服务端数据源');
  ok(chg.hit === 1, `同一人同一目标等级只留 1 条（实际 ${chg.hit} 条：${chg.ids.join(',')}）`);

  /* ---- 3c. 走访：登记 → 刷新 → 档案页必须能看见（B6 修的「入库了但看不见」） ---- */
  console.log('\n=== 真写库（走访：写进 visit 表 → 刷新后可见）===');
  const VNOTE = 'E2E 走访落库验证';
  await page.goto(WEB + '/person.html?id=P0433', { waitUntil: 'load' });
  await page.waitForTimeout(300);
  const vBase = await page.evaluate(() => DATA.visitsOf(DATA.personById('P0433')).length);
  await page.evaluate(note => STORE.addVisit('P0433', { way: '入户走访', result: note }), VNOTE);
  await page.waitForTimeout(900);
  await page.goto(WEB + '/person.html?id=P0433&refresh=1', { waitUntil: 'load' });
  await page.waitForTimeout(2400);
  const visit = await page.evaluate(note => {
    const p = DATA.personById('P0433');
    const list = STORE.visits(p);
    const rows = DATA.visitsOf(p);
    return {
      server: rows.length, merged: list.length,
      hit: list.filter(v => v.result === note).length,
      ids: rows.filter(v => v.result === note).map(v => v.id),
      text: document.body.innerText.indexOf(note) > -1,
      live: !!API.live()
    };
  }, VNOTE);
  ok(visit.live, '刷新后仍是服务端数据源');
  ok(visit.server === vBase + 1, `服务端该人走访 ${vBase} → ${vBase + 1} 条（刚登记的一条落库，实际 ${visit.server}）`);
  ok(visit.hit === 1, `刚登记的走访只出现 1 次、不重复（实际 ${visit.hit}，id ${visit.ids.join(',') || '—'}）`);
  ok(visit.text, '档案页 DOM 上能看到这条新走访（缺陷「入库了但刷新看不见」已修）');

  /* ---- 4. 刷新后仍在（写库不是内存态） ---- */
  await page.goto(WEB + '/alerts.html?refresh=1', { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  const persisted = await page.evaluate(() => {
    const a = STORE.alert('AL-20261110-020');
    return a ? a.status : null;
  });
  ok(persisted === '已处置' || persisted === '已闭环', `刷新后仍是已处置（实际 ${persisted}）`);

  /* ---- 5. 换 R1 真登录：403 端点降级，不许把整份快照拖成「本地演示数据」 ---- */
  console.log('\n=== R1 真登录（无 risk:history:view / visit:view → 端点降级）===');
  /* 本段验的是「R1 无权限 → 回落本地种子 46 条」的口径，但前面第 3/4 段真的写过一条等级变动与一次走访，
     乐观行还在 sessionStorage 里，同 tab 换角色重登会被算进去（47 而非 46）——先清干净，避免顺序耦合。 */
  await page.evaluate(() => { try { sessionStorage.clear(); localStorage.clear(); } catch (e) { /* ignore */ } });
  await page.goto(WEB + '/login.html?live=0', { waitUntil: 'load' });   // 清令牌与 live 开关
  await page.waitForTimeout(250);
  await page.click('.demo-item[data-role="leader"]');
  await page.click('.src-tab[data-src="live"]');
  await page.click('#btnLogin');
  await page.waitForURL(/dashboard\.html/, { timeout: 25000 });
  await page.waitForTimeout(700);
  const r1 = await page.evaluate(() => ({
    live: !!(window.API && API.live()),
    offline: API.status().offline,
    role: STORE.role().roleName,
    denied: (API.status().denied || []).map(d => d.path),
    changes: STORE.changes().length,
    persons: DATA.persons.length,
    masked: DATA.persons.filter(p => p.name.indexOf('*') > -1).length
  }));
  ok(r1.live === true && r1.offline === false,
    `R1 快照整体成功（live=${r1.live}, offline=${r1.offline}）—— 403 只降级单个端点`);
  ok(r1.denied.indexOf('/level-changes') > -1 && r1.denied.indexOf('/visits') > -1,
    `降级端点：${r1.denied.join(',') || '无'}`);
  ok(r1.changes === 46, `变动台账回落本地 46 条（实际 ${r1.changes}）`);
  ok(r1.persons === 486 && r1.masked === 486,
    `人员仍走服务端且全部掩码（${r1.masked}/${r1.persons}）· 角色 ${r1.role}`);

  await ctx.close();
  await browser.close();
  console.log(`\n===== 失败项 ${fail} =====`);
  console.log('提醒：本次真的改了库，收尾请执行 cd backend && python -m app.seed');
  process.exit(fail ? 1 : 0);
})();
