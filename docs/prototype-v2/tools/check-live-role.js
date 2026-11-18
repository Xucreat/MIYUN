/* B5 角色视角回归：同一份页面，换服务端身份后必须「范围/掩码/权限」三件事都跟着变
   ------------------------------------------------------------
   用法：node tools/check-live-role.js <snapshot.json> <R1|R2|R4|R5>
   断言：
     1. 14 页零 pageerror（部门/属地收敛后页面不能崩）；
     2. DATA.live() 为真、STORE.role().key === 'live'；
     3. 人员集合范围由服务端决定（R2=486 / R4=435·仅公安 / R5=61·仅溪翁庄）；
     4. 掩码同样由服务端决定（R1 姓名含 *，R4 身份证含 *）；
     5. 无权限的模块不因缺数据而抛错（变动台账 403 → 保留本地演示数据是允许的）。
*/
const fs = require('fs');
const PW = 'C:/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2-6/node_modules/@playwright/cli/node_modules/playwright-core';
const { chromium } = require(PW);

const BASE = process.env.BASE || 'http://127.0.0.1:8081';
const PAGES = ['login', 'dashboard', 'board', 'bigscreen', 'persons', 'person', 'alerts',
  'blind', 'risk', 'wartime', 'query', 'analytics', 'import', 'system'];
const URL_OF = n => (n === 'query' ? 'persons.html?tab=query' : n + '.html');

const EXPECT = {
  R1: { rated: 486, unrated: 612, dept: null, town: null, nameMasked: true, idMasked: true },
  R2: { rated: 486, unrated: 612, dept: null, town: null, nameMasked: false, idMasked: true },
  R4: { rated: 190, unrated: 245, dept: '公安分局', town: null, nameMasked: false, idMasked: true },
  R5: { rated: 26, unrated: 35, dept: null, town: '溪翁庄镇', nameMasked: false, idMasked: true }
};

(async () => {
  const [snapFile, role] = process.argv.slice(2);
  if (!snapFile || !role) { console.error('用法：node tools/check-live-role.js <snapshot.json> <R1|R2|R4|R5>'); process.exit(2); }
  const snap = JSON.parse(fs.readFileSync(snapFile, 'utf8'));
  const exp = EXPECT[role];
  if (!exp) { console.error('未知角色 ' + role); process.exit(2); }

  const browser = await chromium.launch({ channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e && e.message || e)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto(BASE + '/login.html', { waitUntil: 'load' });
  await page.evaluate(s => {
    sessionStorage.setItem('miyun-v2:snap', JSON.stringify(s));
    localStorage.setItem('miyun-v2:live', '1');
    localStorage.setItem('miyun-v2:base', 'http://127.0.0.1:8001/api');
    localStorage.setItem('miyun-v2:token', 'fake');
  }, snap);

  let fail = 0;
  const ok = (cond, msg) => { if (!cond) fail++; console.log(`  ${cond ? 'PASS' : 'FAIL'} ${msg}`); };

  console.log(`=== ${role} 视角（${snapFile}）===`);
  for (const n of PAGES) {
    errors.length = 0;
    const r = await page.goto(BASE + '/' + URL_OF(n), { waitUntil: 'load' });
    await page.waitForTimeout(280);
    ok(r && r.status() === 200 && !errors.length,
      `${n.padEnd(10)} http=${r ? r.status() : 0} pageerror=${errors.length}`
      + (errors.length ? ' → ' + errors[0].slice(0, 150) : ''));
  }

  /* 数据范围与掩码 */
  const m = await page.goto(BASE + '/persons.html', { waitUntil: 'load' }).then(() => page.waitForTimeout(240)).then(() => page.evaluate(() => {
    const D = window.DATA, S = window.STORE;
    const r = S.role();
    const nm = D.persons.map(p => p.name);
    const idn = D.persons.map(p => p.idNo);
    return {
      live: !!(window.API && API.live()),
      roleKey: r.key, roleName: r.roleName, scope: r.scope, dept: r.dept, town: r.town,
      canEdit: S.can('edit'), canExportPlain: S.can('exportPlain'),
      rated: D.persons.length, unrated: D.unrated.length,
      depts: Array.from(new Set(D.persons.map(p => p.dept))).sort(),
      towns: Array.from(new Set(D.persons.map(p => p.town))).sort(),
      nameMasked: nm.filter(x => x.indexOf('*') > -1).length,
      idMasked: idn.filter(x => x.indexOf('*') > -1).length,
      maskedFlag: D.persons.filter(p => p.maskedFields && Object.keys(p.maskedFields).length).length,
      first: D.persons[0] ? { name: D.persons[0].name, idNo: D.persons[0].idNo, dept: D.persons[0].dept, town: D.persons[0].town } : null
    };
  }));

  console.log('\n  —— 范围与掩码 ——');
  ok(m.live, '快照已在脚本解析期注入（API.live() = true）');
  ok(m.roleKey === 'live', `STORE.role().key = ${m.roleKey}`);
  ok(m.rated === exp.rated, `在册明细 ${m.rated}（期望 ${exp.rated}）`);
  ok(m.unrated === exp.unrated, `待核实明细 ${m.unrated}（期望 ${exp.unrated}）`);
  if (exp.dept) ok(m.depts.length === 1 && m.depts[0] === exp.dept, `部门收敛为「${m.depts.join(',')}」（期望 ${exp.dept}）`);
  if (exp.town) ok(m.towns.length === 1 && m.towns[0] === exp.town, `属地收敛为「${m.towns.join(',')}」（期望 ${exp.town}）`);
  ok(exp.nameMasked ? m.nameMasked > 0 : m.nameMasked === 0,
    `姓名掩码 ${m.nameMasked}/${m.rated} 条（期望 ${exp.nameMasked ? '>0' : '0'}），例：${m.first ? m.first.name : '—'}`);
  ok(exp.idMasked ? m.idMasked === m.rated : m.idMasked === 0,
    `身份证明文 ${m.rated - m.idMasked}/${m.rated} 条（期望 ${exp.idMasked ? '全部掩码' : '全部明文'}），例：${m.first ? m.first.idNo : '—'}`);
  ok(m.maskedFlag === m.rated, `maskedFields 标记覆盖 ${m.maskedFlag}/${m.rated} 条（供前端显示「已脱敏」）`);
  console.log(`  权限位：edit=${m.canEdit} exportPlain=${m.canExportPlain} · 角色 ${m.roleName}`);

  await browser.close();
  console.log(`\n===== ${role} 失败项 ${fail} =====`);
  process.exit(fail ? 1 : 0);
})();
