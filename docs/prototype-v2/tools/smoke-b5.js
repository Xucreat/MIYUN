/* B5 前端冒烟：14 页零 pageerror + 本地/服务端两套数据源数字逐项对账
   ------------------------------------------------------------
   用法：
     node tools/smoke-b5.js            # 只跑本地演示数据
     node tools/smoke-b5.js <snap.json># 先跑本地，再注入服务端快照跑一遍并对比
   前置：
     python -m http.server 8081 -d docs/prototype-v2   （仓库根执行）
   说明：
     服务端快照由 backend/tools/dump_snapshot.py 生成；沙箱内浏览器连不到
     8001，所以这里不走真 HTTP，而是把快照直接塞进 sessionStorage ——
     api.js 在脚本解析期会同步读它并 DATA.hydrate()，验证的正是这段映射。
*/
const fs = require('fs');
const path = require('path');
const PW = 'C:/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2-6/node_modules/@playwright/cli/node_modules/playwright-core';
const { chromium } = require(PW);

const BASE = process.env.BASE || 'http://127.0.0.1:8081';
const PAGES = [
  ['login', 'login.html'],
  ['dashboard', 'dashboard.html'],
  ['board', 'board.html'],
  ['bigscreen', 'bigscreen.html'],
  ['persons', 'persons.html'],
  ['person', 'person.html'],
  ['alerts', 'alerts.html'],
  ['blind', 'blind.html'],
  ['risk', 'risk.html'],
  ['wartime', 'wartime.html'],
  ['query', 'persons.html?tab=query'],
  ['analytics', 'analytics.html'],
  ['import', 'import.html'],
  ['system', 'system.html']
];

function metrics() {
  const D = window.DATA, S = window.STORE;
  const ds = D.deptStats();
  const n = o => (o == null ? null : o);
  return {
    live: !!(window.API && API.live()),
    src: (window.API && API.status) ? API.status().live : null,
    roleKey: S ? S.role().key : null,
    persons: D.persons.length,
    unrated: D.unrated.length,
    changes: D.CHG_FULL.length,
    alerts: D.alerts.length,
    stats: {
      inRegister: D.stats.inRegister, highPlus: D.stats.highPlus, high2: D.stats.high2,
      dual: D.stats.dual, multi: D.stats.multi, unknown: D.stats.unknown,
      noBasis: D.stats.noBasis, ledgerRecords: D.stats.ledgerRecords
    },
    dept: {
      personTimes: ds.personTimes, multiPersons: ds.multiPersons,
      dualCross: ds.dualCross, dualUnion: ds.dualUnion,
      depts: ds.depts.map(d => d.dept + ':' + d.persons).join('|')
    },
    sample: D.persons[0] ? [D.persons[0].id, D.persons[0].town, D.persons[0].level, D.persons[0].tags.join('/')] : null,
    unratedSample: D.unrated[0] ? [D.unrated[0].id, D.unrated[0].level] : null,
    /* B6：走访总和与逐条明细（服务端 visit 表 2,916 行 ↔ 本地按人生成 6 条/486 人） */
    visits: D.persons.reduce((n, p) => n + D.visitsOf(p).length, 0),
    visitSample: (() => {
      const p = D.personById('P0102');
      return p ? D.visitsOf(p).map(v => v.date + ':' + v.way + ':' + v.result).join('|') : null;
    })(),
    denied: (window.API && API.status().denied || []).map(d => d.path).join(','),
    /* 变动台账按 id 排序后整体比对：服务端按发生时间倒序、本地按生成序，顺序不同不算差异 */
    chg: D.CHG_FULL.map(c => c.id + ':' + c.from + '>' + c.to + ':' + c.level).sort().join('|'),
    alertOpen: D.alerts.filter(a => a.status === '待处置').length,
    text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 6000),
    n: n
  };
}

async function run(browser, live, snap) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e && e.message || e)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  // 建 origin，然后决定是否注入快照
  await page.goto(BASE + '/login.html', { waitUntil: 'load' });
  if (live && snap) {
    await page.evaluate(s => {
      sessionStorage.setItem('miyun-v2:snap', JSON.stringify(s));
      localStorage.setItem('miyun-v2:live', '1');
      localStorage.setItem('miyun-v2:base', 'http://127.0.0.1:8001/api');
      localStorage.setItem('miyun-v2:token', 'fake-token-for-offline-smoke');
    }, snap);
  } else {
    await page.evaluate(() => {
      ['miyun-v2:snap', 'miyun-v2:token', 'miyun-v2:live', 'miyun-v2:base', 'miyun-v2:offline']
        .forEach(k => { sessionStorage.removeItem(k); localStorage.removeItem(k); });
    });
  }

  const out = {};
  for (const [name, url] of PAGES) {
    errors.length = 0;
    const resp = await page.goto(BASE + '/' + url, { waitUntil: 'load' });
    await page.waitForTimeout(320);
    const m = await page.evaluate(metrics);
    out[name] = { status: resp ? resp.status() : 0, errors: errors.slice(), m };
  }
  await ctx.close();
  return out;
}

function fmt(v) { return typeof v === 'object' ? JSON.stringify(v) : String(v); }

(async () => {
  const snapFile = process.argv[2];
  const snap = snapFile ? JSON.parse(fs.readFileSync(snapFile, 'utf8')) : null;
  const browser = await chromium.launch({ channel: 'chrome' });
  let fail = 0;

  const mock = await run(browser, false, null);
  console.log('=== 本地演示数据（mock） ===');
  for (const [name, r] of Object.entries(mock)) {
    const bad = r.status !== 200 || r.errors.length;
    if (bad) fail++;
    console.log(`  ${bad ? 'FAIL' : 'PASS'} ${name.padEnd(10)} http=${r.status} pageerror=${r.errors.length}`
      + (r.errors.length ? ' → ' + r.errors[0].slice(0, 160) : ''));
  }
  const m0 = mock.dashboard.m;
  console.log('  口径：在册 ' + m0.stats.inRegister + ' / 高风险+ ' + m0.stats.highPlus + ' / 双在册 ' + m0.stats.dual
    + ' / 多标 ' + m0.stats.multi + ' / 待核实 ' + m0.stats.unknown
    + ' · persons ' + m0.persons + ' · unrated ' + m0.unrated + ' · 变动 ' + m0.changes
    + ' · 预警 ' + m0.alerts + ' · 走访 ' + m0.visits);
  console.log('  部门口径：人次 ' + m0.dept.personTimes + ' / 跨部门 ' + m0.dept.multiPersons
    + ' / 交叉 ' + m0.dept.dualCross + ' / 并集 ' + m0.dept.dualUnion);

  if (snap) {
    const live = await run(browser, true, snap);
    console.log('\n=== 服务端快照（live） ===');
    for (const [name, r] of Object.entries(live)) {
      const bad = r.status !== 200 || r.errors.length || !r.m.live;
      if (bad) fail++;
      console.log(`  ${bad ? 'FAIL' : 'PASS'} ${name.padEnd(10)} http=${r.status} live=${r.m.live} role=${r.m.roleKey}`
        + ` pageerror=${r.errors.length}` + (r.errors.length ? ' → ' + r.errors[0].slice(0, 160) : ''));
    }
    const m1 = live.dashboard.m;
    console.log('  口径：在册 ' + m1.stats.inRegister + ' / 高风险+ ' + m1.stats.highPlus + ' / 双在册 ' + m1.stats.dual
      + ' / 多标 ' + m1.stats.multi + ' / 待核实 ' + m1.stats.unknown
      + ' · persons ' + m1.persons + ' · unrated ' + m1.unrated + ' · 变动 ' + m1.changes
      + ' · 预警 ' + m1.alerts + ' · 走访 ' + m1.visits);

    /* 逐项对账：mock 与 live 的数据本体必须完全一致（同一份种子，两条链路） */
    const KEYS = ['persons', 'unrated', 'changes', 'alerts', 'alertOpen', 'sample', 'unratedSample', 'chg',
      'visits', 'visitSample'];
    const SK = ['inRegister', 'highPlus', 'high2', 'dual', 'multi', 'unknown', 'noBasis', 'ledgerRecords'];
    const DK = ['personTimes', 'multiPersons', 'dualCross', 'dualUnion', 'depts'];
    console.log('\n=== 两套数据源逐项对账 ===');
    for (const [name, a] of Object.entries(mock)) {
      const b = live[name].m;
      const diff = [];
      KEYS.forEach(k => { if (fmt(a.m[k]) !== fmt(b[k])) diff.push(`${k}: ${fmt(a.m[k])} ≠ ${fmt(b[k])}`); });
      SK.forEach(k => { if (a.m.stats[k] !== b.stats[k]) diff.push(`stats.${k}: ${a.m.stats[k]} ≠ ${b.stats[k]}`); });
      DK.forEach(k => { if (fmt(a.m.dept[k]) !== fmt(b.dept[k])) diff.push(`dept.${k}: ${fmt(a.m.dept[k])} ≠ ${fmt(b.dept[k])}`); });
      if (diff.length) { fail++; console.log(`  FAIL ${name.padEnd(10)} ${diff.join(' ; ')}`); }
      else console.log(`  PASS ${name.padEnd(10)} 数字一致`);
    }
    /* 首页文案抽查：五个核心数都得能在 DOM 上看到 */
    const txt = live.dashboard.m.text;
    ['6,028', '486'].forEach(s => {
      const ok = txt.indexOf(s) > -1;
      if (!ok) fail++;
      console.log(`  ${ok ? 'PASS' : 'FAIL'} dashboard 文案含「${s}」`);
    });
  }

  await browser.close();
  console.log(`\n===== 失败项 ${fail} =====`);
  process.exit(fail ? 1 : 0);
})();
