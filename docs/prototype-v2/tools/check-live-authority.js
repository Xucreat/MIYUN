/* 服务端权威性回归（B6-2）：预警「责任单位」在 live 下取自 dept_raw，不是本地兜底
   ------------------------------------------------------------
   为什么要有这一支：`alert.dept_id` 是外键，镇街综治中心这类单位映射不上就是 NULL，
   B6-2 之前责任单位只能从本地演示数据补 —— 服务端预警配本地责任单位，两套口径。
   本脚本证明映射真的走服务端：把快照里的 deptRaw 改成一个绝不出现在本地的串，
   页面必须显示它；对照组（mock，不注入快照）必须仍是本地原文。

   不写库：只改内存里的快照副本，可随时重跑。
   用法：node tools/check-live-authority.js tools/snapshot-r2.json
*/
const PW = 'C:/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2-6/node_modules/@playwright/cli/node_modules/playwright-core';
const { chromium } = require(PW);
const fs = require('fs');

const BASE = process.env.BASE || 'http://127.0.0.1:8081';
const FILE = process.argv[2];
const PROBE = '【服务端权威】镇街综治中心（改自快照）';
if (!FILE || !fs.existsSync(FILE)) {
  console.log('用法：node tools/check-live-authority.js <snapshot.json>');
  process.exit(2);
}

let fail = 0;
const ok = (c, m) => { if (!c) fail++; console.log(`  ${c ? 'PASS' : 'FAIL'} ${m}`); };

(async () => {
  const snap = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const browser = await chromium.launch({ channel: 'chrome' });
  const inject = async (page, s) => page.evaluate(x => {
    sessionStorage.setItem('miyun-v2:snap', JSON.stringify(x));
    localStorage.setItem('miyun-v2:live', '1');
    localStorage.setItem('miyun-v2:base', 'http://127.0.0.1:8001/api');
    localStorage.setItem('miyun-v2:token', 'fake-token-offline-check');
  }, s);

  /* ---- 1. 对照组：mock 模式，责任单位来自本地演示数据 ---- */
  console.log('=== 对照组（mock，不注入快照）===');
  const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pA = await ctxA.newPage();
  await pA.goto(BASE + '/login.html', { waitUntil: 'load' });
  await pA.evaluate(() => ['miyun-v2:snap', 'miyun-v2:token', 'miyun-v2:live', 'miyun-v2:base', 'miyun-v2:offline']
    .forEach(k => { sessionStorage.removeItem(k); localStorage.removeItem(k); }));
  await pA.goto(BASE + '/alerts.html', { waitUntil: 'load' });
  await pA.waitForTimeout(400);
  const mockFirst = await pA.evaluate(() => {
    const n = document.querySelector('.alert-item');
    return { id: n && n.dataset.id, meta: n ? n.querySelector('.ai-meta').textContent : '' };
  });
  ok(!!mockFirst.id && /责任单位：/.test(mockFirst.meta), `mock 首条卡片渲染出责任单位（${mockFirst.id}）`);
  ok(mockFirst.meta.indexOf(PROBE) < 0, 'mock 下不含探针串（探针串来自我们改过的快照）');
  await ctxA.close();

  /* ---- 2. 实验组：把首条预警的 deptRaw 改掉，页面必须跟着变 ---- */
  console.log('\n=== 实验组（注入改过 deptRaw 的快照）===');
  const aid = mockFirst.id;
  const target = (snap.alerts || []).find(a => a.id === aid);
  if (!target) { console.log(`  SKIP 快照里没有 ${aid}（快照与当前列表页可能不同源）`); await browser.close(); process.exit(2); }
  const original = target.deptRaw;
  target.deptRaw = PROBE;

  const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pB = await ctxB.newPage();
  const errs = [];
  pB.on('pageerror', e => errs.push(String(e.message || e)));
  await pB.goto(BASE + '/login.html', { waitUntil: 'load' });
  await inject(pB, snap);
  await pB.goto(BASE + '/alerts.html', { waitUntil: 'load' });
  await pB.waitForTimeout(500);
  const out = await pB.evaluate(id => {
    const card = document.querySelector('.alert-item[data-id="' + id + '"]');
    const fromStore = (STORE.alerts() || []).find(a => a.id === id) || {};
    return {
      live: !!(window.API && API.live()),
      storeDept: fromStore.dept,
      meta: card ? card.querySelector('.ai-meta').textContent : 'NO-CARD'
    };
  }, aid);
  ok(out.live === true, '已进入服务端数据源');
  ok(out.storeDept === PROBE, `STORE.alerts() 的 dept 来自 deptRaw（实际「${out.storeDept}」）`);
  ok(out.meta.indexOf(PROBE) > -1, `卡片 DOM 渲染的是服务端值（原值「${original}」）`);
  ok(out.meta.indexOf(original) < 0, `卡片上不再出现本地原值「${original}」`);
  ok(errs.length === 0, `零 pageerror（实际 ${errs.length}${errs.length ? '：' + errs[0].slice(0, 100) : ''}）`);

  await browser.close();
  console.log(`\n===== 失败项 ${fail} =====`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FATAL ' + String(e && e.stack || e).split('\n').slice(0, 3).join(' / ')); process.exit(1); });
