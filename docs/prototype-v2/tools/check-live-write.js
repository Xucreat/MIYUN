/* B5 写回契约回归：前端三个写操作到底发了什么给服务端
   ------------------------------------------------------------
   为什么用拦截而不是真打接口：沙箱里浏览器连不到 127.0.0.1:8001，
   而这里要验的也不是服务端业务逻辑（B4 的 api_checks_b4 已 74 条覆盖），
   而是「前端 store → API → 请求体」这一段契约：
     · 状态词表翻译（已闭环 → 已处置）
     · 只传客户端可信字段（rule / approver / by / from 一律不传）
     · mock 模式下不许发请求
     · 服务端 500 时页面不崩、只降级提示
   用法：node tools/check-live-write.js tools/snapshot-r2.json
*/
const fs = require('fs');
const PW = 'C:/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2-6/node_modules/@playwright/cli/node_modules/playwright-core';
const { chromium } = require(PW);

const BASE = process.env.BASE || 'http://127.0.0.1:8081';

(async () => {
  const snapFile = process.argv[2];
  if (!snapFile) { console.error('用法：node tools/check-live-write.js <snapshot.json>'); process.exit(2); }
  const snap = JSON.parse(fs.readFileSync(snapFile, 'utf8'));

  const browser = await chromium.launch({ channel: 'chrome' });
  let fail = 0;
  const ok = (c, m) => { if (!c) fail++; console.log(`  ${c ? 'PASS' : 'FAIL'} ${m}`); };

  async function open(live) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const seen = [];
    const errors = [];
    page.on('pageerror', e => errors.push(String(e && e.message || e)));
    let mode = 'ok';
    await page.route('**/api/**', route => {
      const r = route.request();
      seen.push({ method: r.method(), url: r.url().replace(/^https?:\/\/[^/]+/, ''), body: r.postData() });
      if (mode === 'fail') return route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":{"code":"boom","reason":"模拟故障"}}' });
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    });
    await page.goto(BASE + '/login.html', { waitUntil: 'load' });
    await page.evaluate(s => {
      if (s) {
        sessionStorage.setItem('miyun-v2:snap', JSON.stringify(s));
        localStorage.setItem('miyun-v2:live', '1');
        localStorage.setItem('miyun-v2:base', 'http://127.0.0.1:8001/api');
        localStorage.setItem('miyun-v2:token', 'fake');
      } else {
        ['miyun-v2:snap', 'miyun-v2:token', 'miyun-v2:live', 'miyun-v2:base'].forEach(k => {
          sessionStorage.removeItem(k); localStorage.removeItem(k);
        });
      }
    }, live ? snap : null);
    await page.goto(BASE + '/persons.html', { waitUntil: 'load' });
    await page.waitForTimeout(200);
    return { ctx, page, seen, errors, setMode: m => { mode = m; } };
  }

  /* ---- 1. mock 模式：一个请求都不许发 ---- */
  console.log('=== mock 模式（本地演示）===');
  {
    const s = await open(false);
    await s.page.evaluate(() => {
      STORE.handleAlert('AL-20261110-020', '已闭环', 'mock 不该落库');
      STORE.addChange({ personId: 'P0433', name: '任玉荣', town: '鼓楼街道', from: 'mid', to: 'high', reason: 'mock' });
      STORE.addVisit('P0433', { way: '入户走访', result: '情况稳定' });
    });
    await s.page.waitForTimeout(300);
    ok(s.seen.length === 0, `未发出任何请求（实际 ${s.seen.length} 条：${s.seen.map(x => x.method + ' ' + x.url).join(', ') || '—'}）`);
    ok(s.errors.length === 0, `零 pageerror（实际 ${s.errors.length}）`);
    await s.ctx.close();
  }

  /* ---- 2. live 模式：三个写操作各发一条契约正确的请求 ---- */
  console.log('\n=== live 模式（服务端快照已注入）===');
  const s = await open(true);
  ok(await s.page.evaluate(() => !!API.live()), 'live 快照已注入');

  s.seen.length = 0;
  await s.page.evaluate(() => STORE.handleAlert('AL-20261110-020', '已闭环', '已电话核实并补录走访'));
  await s.page.waitForTimeout(250);
  const a = s.seen[0] || {};
  ok(s.seen.length === 1 && a.method === 'POST' && a.url === '/api/alerts/AL-20261110-020/dispose',
    `预警处置 → ${a.method || '-'} ${a.url || '-'}`);
  let body = {};
  try { body = JSON.parse(a.body || '{}'); } catch (e) { /* ignore */ }
  ok(body.status === '已处置', `状态词表翻译：已闭环 → ${body.status}`);
  ok(body.note === '已电话核实并补录走访', `备注透传：${body.note}`);
  ok(!('by' in body) && !('role' in body) && !('at' in body), '未上送 by / role / at（由服务端生成）');

  s.seen.length = 0;
  await s.page.evaluate(() => STORE.transferAlert('AL-20261110-019', '王振国'));
  await s.page.waitForTimeout(250);
  const t = s.seen[0] || {};
  let tbody = {};
  try { tbody = JSON.parse(t.body || '{}'); } catch (e) { /* ignore */ }
  ok(t.method === 'POST' && t.url === '/api/alerts/AL-20261110-019/dispose' && tbody.status === '转派' && tbody.to === '王振国',
    `预警转派 → ${t.method || '-'} ${t.url || '-'} ${t.body || ''}`);

  s.seen.length = 0;
  await s.page.evaluate(() => STORE.addChange({
    personId: 'P0433', name: '任玉荣', town: '鼓楼街道', dept: '公安分局',
    from: 'mid', to: 'high', reason: '新增扬言记录', level: '部门主管 + 分管领导会商', approver: '王立 + 分管领导'
  }));
  await s.page.waitForTimeout(250);
  const c = s.seen[0] || {};
  let cbody = {};
  try { cbody = JSON.parse(c.body || '{}'); } catch (e) { /* ignore */ }
  ok(c.method === 'POST' && c.url === '/api/level-changes', `登记等级变动 → ${c.method || '-'} ${c.url || '-'}`);
  ok(cbody.personId === 'P0433' && cbody.to === 'high' && cbody.reason === '新增扬言记录',
    `变动体：${c.body}`);
  ok(!('level' in cbody) && !('approver' in cbody) && !('from' in cbody),
    '未上送 level / approver / from（定级责任由服务端按 LEVEL_RULE_OF 生成）');

  s.seen.length = 0;
  await s.page.evaluate(() => STORE.addVisit('P0433', { way: '入户走访', result: '情况稳定' }));
  await s.page.waitForTimeout(250);
  const v = s.seen[0] || {};
  let vbody = {};
  try { vbody = JSON.parse(v.body || '{}'); } catch (e) { /* ignore */ }
  ok(v.method === 'POST' && v.url === '/api/persons/P0433/visits', `走访登记 → ${v.method || '-'} ${v.url || '-'}`);
  /* live 下时间跟真实时钟走（服务端按 now 落库），所以这里只校验格式与「就是今天」 */
  const today = new Date();
  const ymd = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
  ok(vbody.way === '入户走访' && vbody.result === '情况稳定' && vbody.date === ymd,
    `走访体：${v.body}（期望日期 ${ymd}）`);

  /* ---- 3. 服务端 500：页面不崩、降级提示 ---- */
  console.log('\n=== 服务端故障降级 ===');
  s.errors.length = 0;
  s.setMode('fail');
  s.seen.length = 0;
  await s.page.evaluate(() => STORE.handleAlert('AL-20261110-018', '已闭环', '服务端会 500'));
  await s.page.waitForTimeout(400);
  const st = await s.page.evaluate(() => API.status());
  ok(s.seen.length === 1, `故障时仍只发一条请求（实际 ${s.seen.length}）`);
  ok(s.errors.length === 0, `零 pageerror（写回失败不抛到页面，实际 ${s.errors.length}）`);
  ok(st.offline === true, 'status().offline 置真，顶栏可提示「服务端未连接」');
  ok((await s.page.evaluate(() => STORE.alert('AL-20261110-018').status)) === '已闭环',
    '本地仍按用户操作更新（演示不被服务端故障卡住）');

  await s.ctx.close();
  await browser.close();
  console.log(`\n===== 失败项 ${fail} =====`);
  process.exit(fail ? 1 : 0);
})();
