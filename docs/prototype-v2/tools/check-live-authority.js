/* 服务端权威性回归（B6-2 / B6-3a）：哪些字段在 live 下取自服务端，而不是本地兜底
   1. 预警「责任单位」→ alert.dept_raw
   2. 权限矩阵三态 → role_perm.mode（48 码 × 9 角色）
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
  const mockPerm = await pA.evaluate(() => {
    const tri = { on: 0, half: 0 };
    Object.keys(DATA.SYS_ROLE_PERMS).forEach(k => {
      const m = DATA.SYS_ROLE_PERMS[k] || {};
      Object.keys(m).forEach(c => { if (m[c] === 'on') tri.on++; else if (m[c] === 'half') tri.half++; });
    });
    return { tri, r4: STORE.permStat('R4'), tagCreate: DATA.SYS_ROLE_PERMS.R4['tag:create'] };
  });
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

  /* ---- 3. 权限矩阵三态：服务端 role_perm.mode 是权威（B6-3a） ---- */
  console.log('\n=== 权限矩阵三态（B6-3a）===');
  await pB.goto(BASE + '/system.html', { waitUntil: 'load' });
  await pB.waitForTimeout(600);
  const livePerm = await pB.evaluate(() => {
    const tri = { on: 0, half: 0, off: 0 };
    Object.keys(DATA.SYS_ROLE_PERMS).forEach(k => {
      const m = DATA.SYS_ROLE_PERMS[k] || {};
      Object.keys(m).forEach(c => { if (m[c] === 'on') tri.on++; else if (m[c] === 'half') tri.half++; else tri.off++; });
    });
    return {
      tri, r4: STORE.permStat('R4'),
      chips: Array.from(document.querySelectorAll('#permGroups .perm')).length,
      chipCls: Array.from(document.querySelectorAll('#permGroups .perm'))
        .filter(n => n.classList.contains('on') || n.classList.contains('half') || n.classList.contains('off')).length
    };
  });
  ok(livePerm.tri.on === 106 && livePerm.tri.half === 16,
    `live 三态 106 on / 16 half（实际 ${livePerm.tri.on} / ${livePerm.tri.half}）`);
  ok(livePerm.tri.on === mockPerm.tri.on && livePerm.tri.half === mockPerm.tri.half,
    `与 mock 静态表逐项同规模（mock ${mockPerm.tri.on}/${mockPerm.tri.half}）`);
  ok(livePerm.r4.on === mockPerm.r4.on && livePerm.r4.half === mockPerm.r4.half,
    `R4 三态 ${livePerm.r4.on}/${livePerm.r4.half}/${livePerm.r4.off} 与 mock 一致`);
  ok(livePerm.chips === 48 && livePerm.chipCls === 48,
    `权限详情渲染 48 个三态 chip（实际 ${livePerm.chips}，带三态 class ${livePerm.chipCls}）`);

  /* 把 R4 一个原本「禁止」的码在快照里改成「允许」，页面必须跟着变 ——
     若仍读本地静态表，这里会失败。 */
  const snap2 = JSON.parse(JSON.stringify(snap));
  const r4row = (snap2.roles.roles || []).find(x => x.key === 'R4');
  ok(!!r4row, '快照里带 roles（/roles 已进 sync）');
  const baseTag = mockPerm.tagCreate;
  r4row.modes = Object.assign({}, r4row.modes, { 'tag:create': 'on' });
  const ctxC = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pC = await ctxC.newPage();
  const errs3 = [];
  pC.on('pageerror', e => errs3.push(String(e.message || e)));
  await pC.goto(BASE + '/login.html', { waitUntil: 'load' });
  await inject(pC, snap2);
  await pC.goto(BASE + '/system.html', { waitUntil: 'load' });
  await pC.waitForTimeout(600);
  const changed = await pC.evaluate(() => ({
    tagCreate: DATA.SYS_ROLE_PERMS.R4['tag:create'],
    r4: STORE.permStat('R4')
  }));
  ok(changed.tagCreate === 'on', `R4 tag:create 从「${baseTag}」变为 on（服务端 modes 生效）`);
  ok(changed.r4.on === mockPerm.r4.on + 1,
    `R4 允许数 ${mockPerm.r4.on} → ${changed.r4.on}（3a 的 half 未丢）`);
  ok(changed.r4.half === mockPerm.r4.half, `R4 受限数仍 ${mockPerm.r4.half}（三态没被压成二态）`);
  ok(errs3.length === 0, `零 pageerror（实际 ${errs3.length}）`);
  await ctxC.close();

  await browser.close();
  console.log(`\n===== 失败项 ${fail} =====`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FATAL ' + String(e && e.stack || e).split('\n').slice(0, 3).join(' / ')); process.exit(1); });
