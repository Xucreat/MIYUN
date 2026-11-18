/* B6 乐观行合并回归：srvId 回填 + 业务键「配额消耗」去重
   ------------------------------------------------------------
   修的缺陷（B5 遗留）：
     旧实现 `local.filter(c => !seen[key])` 把业务键当唯一键，一条服务端行会连带吞掉
     所有同键本地行 → 同一天对同一人登记两次同向变动、而服务端只落了一条（第二写失败
     或响应丢失）时，第二条在页面上直接消失，等于静默丢数据。
   新实现（STORE 内部 mergeOptimistic）：
     ① 有 srvId 的本地行按服务端 id 精确认领，吃一份配额；
     ② 剩余本地行按业务键一条换一条消耗配额，配额外的一律保留。
   用法：node tools/check-live-dedupe.js tools/snapshot-r2.json
   不需要数据库：写回用 route 拦截造假响应，只验前端合并逻辑。
*/
const fs = require('fs');
const PW = 'C:/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2-6/node_modules/@playwright/cli/node_modules/playwright-core';
const { chromium } = require(PW);

const BASE = process.env.BASE || 'http://127.0.0.1:8081';

(async () => {
  const snapFile = process.argv[2];
  if (!snapFile) { console.error('用法：node tools/check-live-dedupe.js <snapshot.json>'); process.exit(2); }
  const SNAP = JSON.parse(fs.readFileSync(snapFile, 'utf8'));

  const browser = await chromium.launch({ channel: 'chrome' });
  let fail = 0;
  const ok = (c, m) => { if (!c) fail++; console.log(`  ${c ? 'PASS' : 'FAIL'} ${m}`); };

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e && e.message || e)));

  /* 写回造假：POST /level-changes 依次回 CHG-202611-901/902，POST visits 回 P0433-V99 */
  let nChg = 900;
  const seen = [];
  await page.route('**/api/**', route => {
    const r = route.request();
    const url = r.url().replace(/^https?:\/\/[^/]+/, '');
    seen.push(r.method() + ' ' + url);
    if (url.indexOf('/level-changes') > -1) {
      nChg += 1;
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, change: { id: 'CHG-202611-' + nChg } })
      });
    }
    if (/\/visits$/.test(url)) {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, visit: { id: 'P0433-V99', personId: 'P0433', date: '2026-11-18' } })
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });

  const boot = async (snap) => {
    await page.goto(BASE + '/login.html', { waitUntil: 'load' });
    await page.evaluate(s => {
      sessionStorage.setItem('miyun-v2:snap', JSON.stringify(s));
      localStorage.setItem('miyun-v2:live', '1');
      localStorage.setItem('miyun-v2:base', 'http://127.0.0.1:8001/api');
      localStorage.setItem('miyun-v2:token', 'fake');
    }, snap);
    await page.goto(BASE + '/person.html?id=P0433', { waitUntil: 'load' });
    await page.waitForTimeout(260);
  };
  /* 清干净再 boot：只清 snap 不清 live 的话，api.js 会走「无快照 → sync → location.reload」
     分支，evaluate 的上下文会被销毁（第一版就是踩了这个） */
  const wipe = () => page.evaluate(() => {
    sessionStorage.removeItem('miyun-demo-v2');
    ['miyun-v2:snap', 'miyun-v2:offline', 'miyun-v2:boot'].forEach(k => sessionStorage.removeItem(k));
    ['miyun-v2:live', 'miyun-v2:token'].forEach(k => localStorage.removeItem(k));
  });

  /* ---- 1. 写回回填 srvId ---- */
  console.log('=== 1. 写回回填（服务端 id → 本地乐观行）===');
  await boot(SNAP);
  ok(await page.evaluate(() => !!API.live()), 'live 快照已注入');
  await page.evaluate(() => {
    STORE.addChange({ personId: 'P0433', name: '任玉荣', town: '鼓楼街道', dept: '公安分局',
      from: 'high', to: 'high2', reason: 'B6 回填 1' });
    STORE.addChange({ personId: 'P0433', name: '任玉荣', town: '鼓楼街道', dept: '公安分局',
      from: 'high', to: 'high2', reason: 'B6 回填 2' });
    STORE.addVisit('P0433', { way: '入户走访', result: 'B6 走访回填' });
  });
  await page.waitForTimeout(600);
  const fill = await page.evaluate(() => {
    const chg = (STORE.state.newChanges || []).map(c => [c.id, c.srvId || null, c.reason]);
    const vis = (STORE.state.visits['P0433'] || []).map(v => [v.way, v.result, v.srvId || null]);
    return { chg, vis };
  });
  ok(fill.chg.length === 2, `两次登记各留一条本地乐观行（实际 ${fill.chg.length}）`);
  ok(fill.chg.every(x => !!x[1]), `两条都回填了 srvId：${fill.chg.map(x => x[0] + '→' + x[1]).join(', ')}`);
  ok(fill.chg[0][1] !== fill.chg[1][1], '两条 srvId 不相同（同日同向也算两次独立登记）');
  ok(fill.vis.length === 1 && fill.vis[0][2] === 'P0433-V99',
    `走访回填 srvId = ${fill.vis.length ? fill.vis[0][2] : '无'}`);
  ok(errors.length === 0, `零 pageerror（实际 ${errors.length}）`);

  /* ---- 2. 模拟刷新：服务端只落了一条，本地有两条 → 必须仍显示两条 ---- */
  console.log('\n=== 2. 刷新后合并（本地 2 条 / 服务端 1 条：旧实现会吞掉一条）===');
  const chgRows = await page.evaluate(() => (STORE.state.newChanges || []).map(c => ({
    id: c.srvId, personId: c.personId, name: c.name, town: c.town, dept: c.dept,
    date: c.date, from: c.from, to: c.to, reason: c.reason, rule: c.level, approver: c.approver,
    at: c.at, status: '已生效', notified: true
  })));
  const onlyOne = {
    ...SNAP,
    changes: SNAP.changes.concat([chgRows[0]])     // 服务端只回了一条
  };
  await boot(onlyOne);
  const m2 = await page.evaluate(() => {
    const hit = STORE.changes().filter(c => c.personId === 'P0433' && c.to === 'high2');
    return { n: hit.length, ids: hit.map(c => c.id) };
  });
  ok(m2.n === 2, `显示 2 条（实际 ${m2.n}：${m2.ids.join(', ') || '—'}）`);
  ok(new Set(m2.ids).size === m2.n, '两条 id 不重复');

  /* ---- 3. 两条都落库：仍然只有两条（不许变成四条） ---- */
  console.log('\n=== 3. 刷新后合并（本地 2 条 / 服务端 2 条）===');
  await boot({ ...SNAP, changes: SNAP.changes.concat(chgRows) });
  const m3 = await page.evaluate(() => {
    const hit = STORE.changes().filter(c => c.personId === 'P0433' && c.to === 'high2');
    return { n: hit.length, ids: hit.map(c => c.id) };
  });
  ok(m3.n === 2, `仍是 2 条、不重复（实际 ${m3.n}：${m3.ids.join(', ')}）`);

  /* ---- 4. 没有任何 srvId（响应丢失）时按业务键一对一消耗 ---- */
  console.log('\n=== 4. 无 srvId 兜底（业务键一条换一条）===');
  await wipe();
  await boot(SNAP);
  const m4 = await page.evaluate(() => {
    const mk = (i, srvId) => ({
      id: 'CHG-202611-20' + i, srvId: srvId || undefined,
      personId: 'P0433', name: '任玉荣', town: '鼓楼街道', dept: '公安分局',
      date: '11-18', from: 'high', to: 'high2', reason: '无回填 ' + i,
      level: '部门主管核定', approver: '王立', at: '2026-11-18 10:0' + i, status: '已生效', live: true
    });
    /* 4a：本地 2 条无 srvId + 服务端 1 条同键 → 只吞 1 条，留 1 条 */
    STORE.state.newChanges = [mk(1), mk(2)];
    DATA.CHG_FULL.push({ id: 'CHG-202611-901', personId: 'P0433', name: '任玉荣', to: 'high2',
      from: 'high', date: '11-18', at: '2026-11-18 10:00', live: true, status: '已生效' });
    const a = STORE.changes().filter(c => c.personId === 'P0433' && c.to === 'high2' && !c.srvId).length;
    const aAll = STORE.changes().filter(c => c.personId === 'P0433' && c.to === 'high2').length;
    /* 4b：再补一条服务端行 → 剩下那条也被认领，总数仍是 2 */
    DATA.CHG_FULL.push({ id: 'CHG-202611-902', personId: 'P0433', name: '任玉荣', to: 'high2',
      from: 'high', date: '11-18', at: '2026-11-18 10:01', live: true, status: '已生效' });
    const bAll = STORE.changes().filter(c => c.personId === 'P0433' && c.to === 'high2').length;
    /* 清理，避免污染后续断言 */
    DATA.CHG_FULL.splice(DATA.CHG_FULL.length - 2, 2);
    STORE.state.newChanges = [];
    return { aLocal: a, aAll, bAll };
  });
  ok(m4.aAll === 2, `本地2+服务端1 → 只吞 1 条、留 1 条，合计 ${m4.aAll} 条`);
  ok(m4.bAll === 2, `再补 1 条服务端行 → 仍是 2 条（实际 ${m4.bAll}）`);

  /* ---- 5. 走访合并：本地已回填 + 服务端有该行 → 不重复 ---- */
  console.log('\n=== 5. 走访合并（落库回填后不重复计一次）===');
  await wipe();
  const visRow = { id: 'P0433-V99', personId: 'P0433', date: '2026-11-18', way: '入户走访',
    result: 'B6 走访回填', by: '陈志远', at: '2026-11-18 10:05' };
  await boot({ ...SNAP, visits: SNAP.visits.concat([visRow]) });
  const m5 = await page.evaluate(() => {
    const p = DATA.personById('P0433');
    const base = DATA.visitsOf(p).length;                       // 服务端 6 条
    STORE.state.visits['P0433'] = [
      { date: '2026-11-18', way: '入户走访', result: 'B6 走访回填', by: '陈志远', srvId: 'P0433-V99' }
    ];
    const merged = STORE.visits(p);
    const dup = merged.filter(v => v.result === 'B6 走访回填').length;
    return { base, merged: merged.length, dup };
  });
  ok(m5.base === 7, `服务端该人 7 条（6 条种子 + 1 条新登记，实际 ${m5.base}）`);
  ok(m5.merged === 7, `合并后不重复计一次（实际 ${m5.merged}）`);
  ok(m5.dup === 1, `「B6 走访回填」只出现 1 次（实际 ${m5.dup}）`);

  ok(errors.length === 0, `全程零 pageerror（实际 ${errors.length}）`);
  await ctx.close();
  await browser.close();
  console.log(`\n===== 失败项 ${fail} =====`);
  process.exit(fail ? 1 : 0);
})();
