/* ============================================================
   data.js · 演示数据唯一来源（Single Source of Truth）
   ------------------------------------------------------------
   规则：
   1. 所有页面只从这里取数，不在页面内硬编码人数 / 统计口径；
   2. 全部数据由固定种子生成，刷新、跨页、跨浏览器结果完全一致；
   3. 汇总口径自上而下可对账：
        全区在册 6,028 = 高风险及以上 486 + 中风险 2,284 + 低风险 2,646 + 待核实 612
        486 = 20 个镇街辖区高风险人数之和（见 towns[].h）
        127 = 双在册（towns[].d 之和）
        214 = 多重标签（2 标 186 + 3 标 28）
   ============================================================ */
window.DATA = (function () {
  'use strict';

  /* ---------- 1. 确定性随机 ---------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  const rnd = mulberry32(20261110);
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));

  /* ---------- 2. 镇街（与地图 admin_level=8 一一对应） ---------- */
  const TOWN_RAW = [
    ['鼓楼街道', 812, 92, 21, 94, '王振国', '副书记'],
    ['果园街道', 756, 84, 18, 92, '李春燕', '综治中心主任'],
    ['檀营地区', 402, 32, 8, 88, '孙志刚', '满族蒙古族乡副书记'],
    ['密云镇', 388, 31, 7, 90, '周文彬', '政法委员'],
    ['溪翁庄镇', 342, 26, 7, 87, '郑海燕', '政法委员'],
    ['十里堡镇', 336, 25, 6, 91, '周立新', '政法委员'],
    ['河南寨镇', 318, 22, 6, 89, '张国庆', '政法委员'],
    ['巨各庄镇', 296, 21, 6, 86, '马晓东', '政法委员'],
    ['穆家峪镇', 284, 19, 6, 93, '赵鹏', '政法委员'],
    ['太师屯镇', 276, 18, 6, 85, '王海峰', '政法委员'],
    ['西田各庄镇', 248, 17, 5, 88, '周立新', '政法委员'],
    ['高岭镇', 242, 16, 5, 84, '孙志刚', '政法委员'],
    ['不老屯镇', 232, 15, 6, 82, '张国庆', '政法委员'],
    ['古北口镇', 186, 12, 4, 95, '郑海燕', '政法委员'],
    ['冯家峪镇', 172, 11, 4, 90, '马晓东', '政法委员'],
    ['石城镇', 164, 11, 3, 78, '赵鹏', '政法委员'],
    ['大城子镇', 158, 10, 3, 87, '李春燕', '政法委员'],
    ['东邵渠镇', 146, 9, 2, 91, '周文彬', '政法委员'],
    ['北庄镇', 142, 8, 2, 93, '孙志刚', '政法委员'],
    ['新城子镇', 128, 7, 2, 96, '王海峰', '政法委员']
  ];

  const VIL = {
    '鼓楼街道': ['长安西社区', '长安东社区', '车站路社区', '宾阳里社区', '花园东社区', '白檀社区', '东菜园社区', '行宫社区', '鼓楼南社区', '沿湖社区'],
    '果园街道': ['果园西社区', '康居社区', '兴云社区', '季庄社区', '新北里社区', '瑞和园社区', '果园东社区', '康馨社区'],
    '檀营地区': ['檀营社区', '满城社区', '回族营社区', '八家庄社区'],
    '密云镇': ['长安社区', '宾阳社区', '花园社区', '南菜园社区', '白檀社区', '沿湖社区'],
    '溪翁庄镇': ['溪翁庄村', '尖岩村', '东智村', '石马峪村', '北白岩村'],
    '十里堡镇': ['十里堡村', '王各庄村', '统军庄村', '河漕村', '靳各寨村'],
    '河南寨镇': ['河南寨村', '团结村', '下屯村', '沙坞村', '台上村'],
    '巨各庄镇': ['巨各庄村', '蔡家洼村', '沙厂村', '豆各庄村', '前焦家坞村'],
    '穆家峪镇': ['穆家峪村', '前栗园村', '后栗园村', '大石岭村', '达岩村'],
    '太师屯镇': ['太师屯村', '流河峪村', '松树峪村', '东学各庄村', '前南台村'],
    '西田各庄镇': ['西田各庄村', '董各庄村', '仓头村', '渤海寨村', '署地村'],
    '高岭镇': ['高岭村', '上甸子村', '下甸子村', '界牌峪村', '辛庄村'],
    '不老屯镇': ['不老屯村', '史庄子村', '学艺厂村', '车道峪村', '陈各庄村', '燕落村'],
    '古北口镇': ['古北口村', '河东村', '河西村', '司马台村', '汤河村'],
    '冯家峪镇': ['冯家峪村', '西口外村', '白莲峪村', '三岔口村', '朱家峪村'],
    '石城镇': ['石城村', '水堡子村', '张家坟村', '黄土坎村', '王庄村'],
    '大城子镇': ['大城子村', '柏崖村', '张泉村', '河下村', '庄户峪村'],
    '东邵渠镇': ['东邵渠村', '水峪村', '太保庄村', '西邵渠村', '界牌村'],
    '北庄镇': ['北庄村', '暖泉会村', '下栅子村', '土门村'],
    '新城子镇': ['新城子村', '曹家路村', '花园村', '遥桥峪村', '东庄禾村']
  };

  const towns = TOWN_RAW.map(([name, v, h, d, m, officer, title]) => ({
    key: name,
    name: name,
    short: name.replace(/(街道|地区|镇|乡)$/, ''),
    v, h, d, m,
    officer, title,
    villages: VIL[name] || []
  }));
  const townOf = key => towns.find(t => t.key === key);

  /* ---------- 3. 标签体系（11 类 · 4 部门） ---------- */
  const TAGS = [
    { name: '涉访 A 类', dept: '区信访办', cls: 'tag-orange' },
    { name: '涉访 B 类', dept: '区信访办', cls: 'tag-orange' },
    { name: '扬言类重点人', dept: '公安分局', cls: 'tag-red' },
    { name: '政保重点人', dept: '公安分局', cls: 'tag-red' },
    { name: '吸毒人员', dept: '公安分局', cls: 'tag-slate' },
    { name: '严重精神障碍', dept: '区卫健委', cls: 'tag-red' },
    { name: '六失一偏', dept: '区卫健委', cls: 'tag-slate' },
    { name: '社区矫正', dept: '区司法局', cls: 'tag-blue' },
    { name: '刑满释放', dept: '区司法局', cls: 'tag-slate' },
    { name: '安置帮教', dept: '区司法局', cls: 'tag-blue' },
    { name: '境外关联', dept: '公安分局', cls: 'tag-purple' }
  ];

  /* ---------- 数据导入标准字段（D6：外置为单一来源，等政务部门给正式字段要求后在此追加） ----------
     命名空间与职责：本常量只描述「源表列 → 标准字段」的映射能力，不含校验逻辑
     （校验在 fileparse.js：身份证校验位、镇街有效性、库内查重）。
     required 仅姓名与身份证号——查重并档以身份证为主键，两者缺一无法合并归档；
     其余字段可缺列，缺列不影响导入通过，仅对应属性留空。 */
  const IMPORT_FIELDS = [
    { key: 'name', label: '姓名', required: true, alias: ['姓名', '人员姓名', '当事人', '名字', 'name'] },
    { key: 'idNo', label: '身份证号', required: true, alias: ['身份证号', '身份证', '身份证号码', '证件号码', 'idcard', 'idno'] },
    { key: 'phone', label: '联系电话', required: false, alias: ['联系电话', '手机号', '手机', '电话', 'phone'] },
    { key: 'tags', label: '风险类别 / 标签', required: false, alias: ['标签', '类别', '风险类别', '人员类别', '类型', 'tag'] },
    { key: 'town', label: '属地镇街', required: false, alias: ['镇街', '属地', '所属镇街', '街道', '乡镇', 'town'] },
    { key: 'dept', label: '来源部门', required: false, alias: ['部门', '来源', '来源部门', '报送单位', 'dept'] },
    { key: 'level', label: '风险等级', required: false, alias: ['等级', '风险等级', '管控等级', 'level'] },
    { key: 'note', label: '备注', required: false, alias: ['备注', '说明', '情况说明', 'note'] }
  ];

  const LEVELS = [
    { key: 'high2', name: '极高风险', cls: 'risk risk-0', order: 0 },
    { key: 'high', name: '高风险', cls: 'risk risk-1', order: 1 },
    { key: 'mid', name: '中风险', cls: 'risk risk-2', order: 2 },
    { key: 'low', name: '低风险', cls: 'risk risk-3', order: 3 },
    { key: 'unknown', name: '待核实', cls: 'risk risk-4', order: 4 }
  ];
  const levelOf = k => LEVELS.find(l => l.key === k) || LEVELS[1];

  /* ---------- 4. 姓名 / 身份证 / 电话生成 ---------- */
  const SURNAME = ('王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾萧田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤').split('');
  const GIVEN = ['玉荣', '文军', '桂兰', '秀英', '长海', '淑芬', '文斌', '国华', '志强', '春霞', '德海', '秀珍', '建军', '志远', '秀兰', '明远', '建华', '振华', '秀云', '立军', '海涛', '丽娟', '桂英', '万山', '长江', '凤兰', '振山', '宝良', '秀梅', '志刚', '文生', '永强', '雅琴', '云生', '树森', '淑珍', '铁柱', '春生', '爱华', '少军', '晓明', '桂芳', '秀荣', '德明', '万福', '金凤', '志国', '文忠', '雅芝', '连生'];
  const usedNames = new Set();
  function makeName() {
    for (let i = 0; i < 400; i++) {
      const n = pick(SURNAME) + pick(GIVEN);
      if (!usedNames.has(n)) { usedNames.add(n); return n; }
    }
    return pick(SURNAME) + pick(GIVEN) + pick(['子', '小', '大']);
  }

  const ID_W = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const ID_C = '10X98765432';
  function idChecksum(body17) {
    let s = 0;
    for (let i = 0; i < 17; i++) s += Number(body17[i]) * ID_W[i];
    return ID_C[s % 11];
  }
  function makeId(birth) {
    const y = birth.slice(0, 4), m = birth.slice(5, 7), d = birth.slice(8, 10);
    const seq = String(int(1, 9)) + String(int(0, 99)).padStart(2, '0');
    const body = '110228' + y + m + d + seq;
    return body + idChecksum(body);
  }
  /* 身份证掩码：6 位地区码 + 8 位星号 + 4 位尾号 = 18 位（如 110228********1234） */
  function maskId(id) { return id.slice(0, 6) + '********' + id.slice(-4); }
  function maskName(n) { return n.length <= 1 ? n : n[0] + '*'.repeat(n.length - 1); }
  function maskPhone(p) { return p.slice(0, 3) + '****' + p.slice(7); }

  /* ---------- 5. 人员台账（486 条 = 高风险及以上） ----------
     逐镇街按 towns[].h 生成，因此台账条数恒等于 486，
     且「镇街 × 等级」二维口径与驾驶舱地图完全一致。 */
  const persons = [];
  let serial = 100;
  towns.forEach(t => {
    for (let i = 0; i < t.h; i++) {
      const birthY = int(1952, 2003);
      const birth = birthY + '-' + String(int(1, 12)).padStart(2, '0') + '-' + String(int(1, 28)).padStart(2, '0');
      const id = makeId(birth);
      const village = t.villages[i % t.villages.length];
      const gender = Number(id[16]) % 2 === 1 ? '男' : '女';
      const name = makeName();
      const phone = '1' + pick(['35', '36', '37', '38', '39', '86', '88']) + String(int(10000000, 99999999));
      serial += int(1, 3);
      persons.push({
        id: 'P' + String(serial).padStart(4, '0'),
        no: 'MY-2026-' + String(serial).padStart(6, '0'),
        name, gender,
        birth,
        age: 2026 - birthY,
        idNo: id,
        phone,
        town: t.key,
        village,
        addr: t.key + village + ' ' + int(1, 18) + ' 号楼 ' + int(1, 6) + '-' + int(101, 604),
        tags: [],
        level: 'high',
        dual: false,
        multi: false,
        officer: t.officer,
        officerTitle: t.title,
        dept: '',
        source: '',
        status: '在管',
        lastVisit: null,
        visitGap: 0,
        visitTotal: 0,
        since: (2019 + int(0, 6)) + '-' + String(int(1, 12)).padStart(2, '0'),
        watch: false,
        noBasis: false
      });
    }
  });

  /* 等级：42 极高 + 444 高（每 11 条取 1 条为极高，分布均匀） */
  persons.forEach((p, i) => { if (i % 11 === 3) p.level = 'high2'; });

  /* 双在册：逐镇街按 towns[].d 取，均匀抽样 */
  towns.forEach(t => {
    const list = persons.filter(p => p.town === t.key);
    const step = list.length / t.d;
    for (let i = 0; i < t.d; i++) list[Math.min(list.length - 1, Math.floor(i * step + step * 0.4))].dual = true;
  });

  /* 标签：28 人 3 标 + 186 人 2 标 + 272 人 1 标 = 486；多标合计 214 */
  const tagPlan = [];
  for (let i = 0; i < 486; i++) tagPlan.push(i < 28 ? 3 : (i < 214 ? 2 : 1));
  // 打散，避免「前 214 条标签多」这种可被看穿的规律
  for (let i = tagPlan.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = tagPlan[i]; tagPlan[i] = tagPlan[j]; tagPlan[j] = tmp;
  }
  persons.forEach((p, i) => {
    const n = tagPlan[i];
    p.multi = n > 1;
    const pool = TAGS.slice();
    for (let k = 0; k < n; k++) {
      const pickIdx = Math.floor(rnd() * pool.length);
      const tag = pool.splice(pickIdx, 1)[0];
      p.tags.push(tag.name);
      if (k === 0) { p.dept = tag.dept; p.source = tag.dept + '台账'; }
    }
  });

  /* 三类盲区去重口径校正 —— 887 = 127（双在册）+ 214（多标）+ 612（未定级）− 66（双在册∩多标）
     随机生成的双标标记算不出恰好 66 的交集，这里做等量置换把它对齐：
       7 名「仅双在册」（1 标）补 1 个标签 → 2 标
       7 名「仅多标·2 标」减到 1 标
     置换净变化为 0，因此 dual=127 / multi=214 / 2标=186 / 3标=28 四个口径全部不动。 */
  (function () {
    const need = 66 - persons.filter(p => p.dual && p.multi).length;
    if (need <= 0) return;
    const dualOnly = persons.filter(p => p.dual && !p.multi && p.tags.length === 1);
    const multi2Only = persons.filter(p => !p.dual && p.multi && p.tags.length === 2);
    const n = Math.min(need, dualOnly.length, multi2Only.length);
    for (let i = 0; i < n; i++) {
      const p = dualOnly[i];
      const extra = TAGS.find(t => p.tags.indexOf(t.name) < 0);
      if (extra) p.tags.push(extra.name);
      const q = multi2Only[i];
      q.tags = [q.tags[0]];
    }
    persons.forEach(p => { p.multi = p.tags.length >= 2; });
  })();

  /* 走访：最近走访按「天数倒序 + 少量超期」生成 */
  persons.forEach(p => {
    const gap = p.level === 'high2' ? int(1, 22) : int(1, 46);
    p.visitGap = gap;
    p.lastVisit = dateBefore(gap);
    p.visitTotal = int(3, 28);
    p.watch = p.tags.length >= 3 || p.level === 'high2';
    p.noBasis = p.level === 'high' && rnd() < 0.31;
  });

  function dateBefore(days, from) {
    const base = from ? new Date(from) : new Date('2026-11-10T09:45:00+08:00');
    base.setDate(base.getDate() - days);
    return base.toISOString().slice(0, 10);
  }
  /* ---------- 跨镇街迁移记录（同源派生） ----------
     看板「跨镇街流动明细 / 同一人 30 日内二次迁入」与一人一档「跨镇街迁移」共用本函数，
     以身份证号为种子确定性生成：同一人每次进入结果完全一致，两处数字与属地不会对不上。 */
  const MOVE_REASON = ['务工随迁', '家庭搬迁', '租房变更', '投靠亲属', '临时居住'];
  const MOVE_STATE = ['已并档', '移交中', '待确认属地责任'];
  function movesOf(p) {
    if (!p || !p.town) return [];
    const key = (p.idNo || p.id || '') + p.town;
    let s = 7;
    for (let i = 0; i < key.length; i++) s = (Math.imul(s, 31) + key.charCodeAt(i)) >>> 0;
    const rnd = mulberry32(s);
    const others = towns.map(t => t.key).filter(t => t !== p.town);
    if (!others.length) return [];
    const r = rnd();
    const n = r < 0.74 ? 1 : (r < 0.92 ? 2 : 3);  // 多数人只迁入 1 次，多次迁入才是少数异常
    const list = [];
    let to = p.town;
    let inDay = 6 + Math.floor(rnd() * 18);       // 最近一次迁入距今 6~23 天
    for (let i = 0; i < n; i++) {
      const from = others[Math.floor(rnd() * others.length)];
      const gap = 9 + Math.floor(rnd() * 19);     // 与上一次迁入的间隔
      const outDay = inDay + gap;
      list.push({
        seq: 0, from, to,
        outDate: dateBefore(outDay),
        inDate: dateBefore(inDay),
        gapDays: gap,
        status: MOVE_STATE[Math.floor(rnd() * MOVE_STATE.length)],
        reason: MOVE_REASON[Math.floor(rnd() * MOVE_REASON.length)],
        taskNo: 'MV-2026' + String(1001 + Math.floor(rnd() * 8998)),
        gapFromPrev: 0
      });
      to = from;                                   // 本条迁出地 = 更早一次迁入的目的地
      inDay = outDay + (2 + Math.floor(rnd() * 6));
    }
    list.reverse();                                // 按时间正序（最早在前）
    list.forEach((m, i) => {
      m.seq = i + 1;
      m.gapFromPrev = i === 0 ? 0 : Math.round((new Date(m.inDate) - new Date(list[i - 1].inDate)) / 86400000);
    });
    return list;
  }
  /* 是否触发「同一人 30 日内二次迁入」预警（档案与看板共用同一判定） */
  function hasSecondMove(p) {
    const l = movesOf(p);
    return l.length >= 2 && l[l.length - 1].gapFromPrev <= 30;
  }
  /* 全量迁移明细（看板「全量明细」用），按当前角色脱敏 */
  function moveRows() {
    const out = [];
    persons.forEach(p => movesOf(p).forEach(m => out.push({ p, m })));
    return out;
  }

  function dateRel(days) {
    if (days === 0) return '今天';
    if (days === 1) return '昨天';
    return days + ' 天前';
  }

  /* ---------- 6. 汇总口径（页面只读这里） ---------- */
  const dualCount = persons.filter(p => p.dual).length;          // 127
  const multiCount = persons.filter(p => p.multi).length;        // 214
  const stats = {
    inRegister: 6028,
    highPlus: persons.length,                                    // 486
    mid: 2284,
    low: 2646,
    unknown: 612,
    dual: dualCount,
    multi: multiCount,
    multi2: persons.filter(p => p.tags.length === 2).length,
    multi3: persons.filter(p => p.tags.length === 3).length,
    high2: persons.filter(p => p.level === 'high2').length,
    noBasis: 358,
    noVisit30: 213,
    noVisit30High: persons.filter(p => p.visitGap > 30).length,
    offRegister: 96,
    monthAdd: 43,
    monthSub: 12,
    monthDelta: 31,
    ledgerRecords: 7112,
    percentHigh: +(persons.length / 6028 * 100).toFixed(1)
  };

  /* ---------- 6b. 未定级人员（612 条 · 独立于 486 高风险台账） ----------
     盲区人群「待核实」一类的明细来源。
     刻意不并入 persons：persons 恒等于 486（= Σ towns[].h），
     一旦混入未定级人员，「高风险及以上」口径就会失真。
     逐镇街按在册人数比例用最大余数法分配，保证合计精确等于 stats.unknown。 */
  function splitByWeight(total, weights) {
    const sum = weights.reduce((a, b) => a + b, 0);
    const raw = weights.map(w => (total * w) / sum);
    const base = raw.map(Math.floor);
    let rest = total - base.reduce((a, b) => a + b, 0);
    const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]);
    for (let k = 0; k < rest; k++) base[order[k % order.length][1]]++;
    return base;
  }

  const unrated = [];
  if (stats.unknown > 0) {
    const quota = splitByWeight(stats.unknown, towns.map(t => t.v));
    const UN_STATUS = ['未定级', '风险不详', '风险不详（拒访）'];
    let us = 6100;
    towns.forEach((t, ti) => {
      for (let i = 0; i < quota[ti]; i++) {
        const birthY = int(1948, 2005);
        const birth = birthY + '-' + String(int(1, 12)).padStart(2, '0') + '-' + String(int(1, 28)).padStart(2, '0');
        const idNo = makeId(birth);
        const gender = Number(idNo[16]) % 2 === 1 ? '男' : '女';
        const tag = TAGS[Math.floor(rnd() * TAGS.length)];
        const gap = int(1, 96);
        us += int(1, 3);
        unrated.push({
          id: 'U' + String(us).padStart(4, '0'),
          no: 'MY-2026-' + String(us).padStart(6, '0'),
          name: makeName(), gender, birth, age: 2026 - birthY, idNo,
          phone: '1' + pick(['35', '36', '37', '38', '39', '86', '88']) + String(int(10000000, 99999999)),
          town: t.key,
          village: t.villages[i % t.villages.length],
          addr: t.key + t.villages[i % t.villages.length] + ' ' + int(1, 18) + ' 号楼 ' + int(1, 6) + '-' + int(101, 604),
          tags: [tag.name],
          level: 'unknown',
          dual: false,
          multi: false,
          officer: t.officer,
          officerTitle: t.title,
          dept: tag.dept,
          source: tag.dept + '台账',
          status: UN_STATUS[int(0, UN_STATUS.length - 1)],
          lastVisit: dateBefore(gap),
          visitGap: gap,
          visitTotal: int(1, 12),
          since: (2020 + int(0, 6)) + '-' + String(int(1, 12)).padStart(2, '0'),
          watch: false,
          noBasis: true
        });
      }
    });
  }

  /* ---------- 7. 预警（18 条 · 7 类规则） ---------- */
  /* 把文案里的具名人员绑定到台账真实记录：优先同镇街 + 同标签，
     绑定时以文案人名为准改写台账姓名，保证「预警—台账—档案」三处同名。 */
  function bindPerson(name, town, preferTags) {
    const exist = persons.find(p => p.name === name);
    if (exist) return exist;
    const pool = persons.filter(p => p.town === town);
    if (!pool.length) return null;
    let target = null;
    if (preferTags && preferTags.length) target = pool.find(p => preferTags.some(t => p.tags.includes(t)));
    if (!target) target = pool.find(p => p.visitGap > 30) || pool[0];
    if (!usedNames.has(name)) { usedNames.delete(target.name); target.name = name; usedNames.add(name); }
    return target;
  }

  /* 数据质量规则（board 报送质量 与 system 规则参数页 同源） */
  const DQ_RULES = [
    { code: 'DQ-01', name: '身份证校验位', desc: '身份证 18 位且校验位符合 GB 11643', hit: 1, on: true, act: '拦截' },
    { code: 'DQ-02', name: '必填字段非空', desc: '姓名 / 证件号 / 属地 / 类别 / 等级等 8 项必填', hit: 5, on: true, act: '告警' },
    { code: 'DQ-03', name: '等级枚举校验', desc: '风险等级在字典枚举内（高/中/低/待核实）', hit: 0, on: true, act: '拦截' },
    { code: 'DQ-04', name: '属地有效性', desc: '属地镇街存在且为启用状态', hit: 0, on: true, act: '拦截' },
    { code: 'DQ-05', name: '走访日期倒置', desc: '走访日期不晚于报送日', hit: 2, on: true, act: '告警' },
    { code: 'DQ-06', name: '重复建档', desc: '同一人同类别在册不重复（导入环节前置查重）', hit: 0, on: true, act: '拦截' }
  ];

  /* 等级变动基础台账（board 等级调整明细 与 risk 本月变动 同源） */
  const CHG_BASE = [
    ['赵文军', '11-09', 'mid', 'high', '涉访行为升级', '鼓楼街道'],
    ['刘桂兰', '11-08', 'mid', 'high', '评估结论变更', '不老屯镇'],
    ['郑建国', '11-06', 'mid', 'low', '矫正期届满', '果园街道'],
    ['陈志刚', '11-05', 'mid', 'high', '双在册确认', '檀营地区']
  ];

  /* ---------- 等级变动全量台账（46 条 · 变动登记 / 全部 46 条 / 导出台账 / 月度报送 同源） ----------
     口径锁定：上调 22 + 下调 24 = 46，与「变动登记」角标逐项对账。
     前 4 条与 CHG_BASE 完全一致，保证 board 的等级调整明细与 risk 页不打架。
     定级责任（会议决议 D4：政法委无审批职能）：等级由部门自主定级、登记即生效，
     政法委侧只做统筹备案与知会，不设审批节点。故 `level` 记的是**部门内部定级责任**，
     `approver` 记的是部门侧责任人；原来的「政法委主管」「政法委 + 双人复核」已全部改掉。 */
  const DEPT_HEAD = {
    '公安分局': '王立', '区信访办': '周敏', '区卫健委': '孙敏', '区司法局': '李明', '区委政法委': '陈志远'
  };

  /* ---------- 部门内部定级责任（四档，台账与「等级变动」页新登记共用） ----------
     一处定义、两处消费：CHG_FULL 生成历史 46 条用，page-risk.js 新登记时用。
     by 里带「分管领导」「集体会商」的，登记人由部门主管姓名 + 责任后缀拼出。 */
  const LEVEL_RULE_OF = k => ({
    'low>mid': { lv: '部门主管核定', by: '部门主管' },
    'mid>low': { lv: '部门主管核定', by: '部门主管' },
    'mid>high': { lv: '部门主管 + 分管领导会商', by: '部门主管 + 分管领导' },
    'high>mid': { lv: '分管领导核定', by: '分管领导' },
    'high>high2': { lv: '部门集体会商 + 双签', by: '集体会商 · 双签' },
    'high2>high': { lv: '部门集体会商 + 双签', by: '集体会商 · 双签' },
    'high2>mid': { lv: '部门集体会商 + 双签', by: '集体会商 · 双签' }
  })[k] || { lv: '分管领导核定', by: '分管领导' };

  /* ---------- 部门维度派生（会议决议 D3 的数据底座） ----------
     口径三条，演示时必须说清：
     1. 人员归属部门由「类别标签 → 部门」映射得出（TAGS[].dept），一人可同时归属多个行业主管部门；
     2. 因此「部门人次」之和 > 在册明细人数，差额即跨部门共管造成的重复计数；
     3. 这里的「跨部门共管」按标签实算，与 stats.dual（双在册 127，政府台账既有的「公安 + 卫健/信访」
        两部门确认标记）不是同一口径，两个数字不可互相替代，也不能简单相减。
     覆盖范围：仅 persons（486 条带完整明细的在册人员）；待核实 612 人不纳入部门统计。 */
  function deptsOf(p) {
    return Array.from(new Set((p.tags || []).map(t => (TAGS.find(x => x.name === t) || {}).dept).filter(Boolean)));
  }
  /* 每次按当前 persons 重算——导入会追加人员，做缓存会立刻失真 */
  function deptStats() {
    const byDept = {};
    const pairs = {};
    const multi = {};
    let personTimes = 0;
    let multiPersons = 0;
    persons.forEach(p => {
      const ds = deptsOf(p);
      personTimes += ds.length;
      if (ds.length > 1) {
        multiPersons += 1;
        multi[ds.length] = (multi[ds.length] || 0) + 1;
      }
      ds.forEach(d => {
        if (!byDept[d]) byDept[d] = { dept: d, head: DEPT_HEAD[d] || '', persons: 0 };
        byDept[d].persons += 1;
      });
      for (let i = 0; i < ds.length; i++) {
        for (let j = i + 1; j < ds.length; j++) {
          const k = [ds[i], ds[j]].sort().join('|');
          pairs[k] = (pairs[k] || 0) + 1;
        }
      }
    });
    const depts = Object.keys(byDept).map(k => byDept[k]).sort((a, b) => b.persons - a.persons);
    return {
      depts,                          // [{ dept, head, persons }] 按人数降序
      personTimes,                    // 部门人次合计（含重复计数）
      uniquePersons: persons.length,  // 去重人数
      multiPersons,                   // 归属 ≥2 个部门的人数
      multi,                          // { 2: n, 3: n } 按归属部门数分布
      pairs                           // { 'A|B': n } 两两重合（键按字典序拼接）
    };
  }
  const CHG_FULL = (function () {
    const PLAN = [
      { from: 'mid', to: 'high', n: 12 }, { from: 'low', to: 'mid', n: 4 }, { from: 'high', to: 'high2', n: 3 },
      { from: 'high', to: 'mid', n: 12 }, { from: 'high2', to: 'high', n: 5 }, { from: 'mid', to: 'low', n: 7 }, { from: 'high2', to: 'mid', n: 3 }
    ];
    const REASON = {
      'mid>high': ['涉访行为升级', '新增扬言记录', '双在册确认后取高', '评估结论变更'],
      'low>mid': ['矫正期满后复评', '新增关注标签', '季度评估上调'],
      'high>high2': ['出现明显被害妄想并拒服药', '应急处置记录升级', 'A 类重点人风险叠加'],
      'high>mid': ['连续 6 个月无异常', '矫正期满转入常规随访', '住院治疗期满出院'],
      'high2>high': ['病情稳定，解除 24 小时监护', '监护人到位且服药规律'],
      'mid>low': ['矫正期届满', '稳定就业 12 个月', '连续 2 年无涉访记录'],
      'high2>mid': ['专科复评下调两档', '长期住院治疗、家庭监护到位']
    };
    /* 部门内部定级责任：与 risk 页「部门内部定级流程」四档一一对应（定义见 LEVEL_RULE_OF） */
    const LEVEL_RULE = LEVEL_RULE_OF;

    const rows = [];
    /* 前 4 条：与 CHG_BASE 完全一致 */
    CHG_BASE.forEach((r, i) => {
      const k = r[2] + '>' + r[3];
      const rule = LEVEL_RULE(k);
      rows.push({
        id: 'CHG-202611-' + String(101 + i).padStart(3, '0'),
        name: r[0], town: r[5], dept: '', personId: '',
        date: r[1], from: r[2], to: r[3], reason: r[4],
        level: rule.lv, approver: rule.by, at: r[1] + ' ' + String(9 + i).padStart(2, '0') + ':' + String(12 + i * 7).padStart(2, '0'),
        status: '已生效'
      });
    });

    /* 其余 42 条：从台账确定性取样（步长 11 与 486 互质，保证不重复） */
    let seq = 105;
    let day = 1;
    for (let pi = 0; pi < PLAN.length; pi++) {
      const plan = PLAN[pi];
      for (let i = 0; i < plan.n; i++) {
        if (rows.length >= 46) break;
        const idx = (seq * 11 + 3) % persons.length;
        const p = persons[idx];
        const k = plan.from + '>' + plan.to;
        const rule = LEVEL_RULE(k);
        const rs = REASON[k] || ['评估结论变更'];
        const dd = String(1 + (day % 10)).padStart(2, '0');
        const head = DEPT_HEAD[p.dept] || '部门主管';
        rows.push({
          id: 'CHG-202611-' + String(seq).padStart(3, '0'),
          name: p.name, town: p.town, dept: p.dept, personId: p.id,
          date: '11-' + dd, from: plan.from, to: plan.to,
          reason: rs[seq % rs.length],
          level: rule.lv,
          /* 登记人：部门侧责任人姓名 + 定级责任后缀（原「+ 陈志远」= 政法委审批，D4 后取消） */
          approver: rule.by === '部门主管'
            ? head
            : (rule.by.indexOf('部门主管') === 0
              ? head + ' + 分管领导'
              : (rule.by === '分管领导' ? head + ' 报分管领导核定' : head + ' · 集体会商双签')),
          at: '11-' + dd + ' ' + String(8 + (seq % 9)).padStart(2, '0') + ':' + String(10 + (seq * 7) % 49).padStart(2, '0'),
          status: '已生效'
        });
        seq++; day++;
      }
    }
    return rows;
  })();

  /* ---------- 处置责任人名录（预警转派 / 盲区指派 / 变动知会共用） ----------
     口径：属地 = 20 个镇街的包联负责人；部门 = 四部门台账主管；区级 = 政法委。
     本名录可在「系统管理 · 账号与角色 · 处置责任人名录」维护，变更写入审计日志。
     会议决议 D4 后区级两人的角色是统筹/备案/知会确认，不再是审批与终审。 */
  const RESPONDERS = (function () {
    const out = [];
    out.push({ id: 'RP-ZF-01', name: '陈志远', unit: '区委政法委', title: '政法委主管', kind: '区级', phone: '139****2101', note: '全区统筹 · 变动备案知会' });
    out.push({ id: 'RP-ZF-02', name: '李国栋', unit: '区委政法委', title: '政法委书记', kind: '区级', phone: '139****2001', note: '统筹督办 · 月度报送审核' });
    [['公安分局', '刘敏', '政保大队'], ['区卫健委', '周敏', '精防办'], ['区信访办', '周敏', '来访接待科'], ['区司法局', '王立', '社区矫正科']].forEach((d, i) => {
      out.push({ id: 'RP-BM-0' + (i + 1), name: d[1], unit: d[0], title: d[2], kind: '部门', phone: '139****3' + String(120 + i), note: d[0] + '台账主责' });
    });
    towns.forEach((t, i) => {
      out.push({
        id: 'RP-ZJ-' + String(i + 1).padStart(2, '0'),
        name: t.officer, unit: t.name, title: t.title, kind: '属地',
        phone: '139****4' + String(100 + i), note: t.name + ' · 在册 ' + t.v + ' 人'
      });
    });
    return out;
  })();


  /* ---------- 预警规则（全站唯一来源：系统管理配置 ↔ 预警待办 ↔ 驾驶舱 同源） ----------
     cond 为结构化条件：{t} 文本片段 / {p} 阈值参数键（与 SYS_PARAMS 双向绑定）
     hit = 今日命中；count = 预警待办条数（两页各自口径，规则定义本身同源）
     board: false = 不在「预警待办」顶部规则统计条展示（停用规则 / 本期零待办的系统治理类），
                   仍完整保留在「规则配置」弹窗中，可查看与开关 */
  const RULES = [
    { code: 'RG-01', name: '走访超期', threshold: '30 日', count: 6, hit: 64, on: true, level: 'high', to: '属地经办',
      cond: [{ t: '连续 ' }, { p: 'visitGap' }, { t: ' 日无有效走访' }],
      desc: '连续超过走访时限无有效走访记录自动生成预警，责任单位须 3 个工作日内闭环。' },
    { code: 'RG-02', name: '失访 / 拒访', threshold: '连续 2 次', count: 3, hit: 18, on: true, level: 'high', to: '属地负责人',
      cond: [{ t: '连续 ' }, { t: '2' }, { t: ' 次入户未接触或明确拒访' }],
      desc: '连续 2 次入户未接触或明确拒访，自动升级为高风险并推送属地和精防医生。' },
    { code: 'RG-03', name: '双在册未确认', threshold: '3 日', count: 2, hit: 9, on: true, level: 'mid', to: '政法委主管',
      cond: [{ t: '两部门在册且 ' }, { p: 'dualConfirm' }, { t: ' 日内未完成双确认' }],
      desc: '同一人员出现在两个部门台账且未完成双确认，超过确认时限触发。' },
    { code: 'RG-04', name: '未定级超期', threshold: '15 日', count: 3, hit: 23, on: true, level: 'mid', to: '对口部门经办',
      cond: [{ t: '建档后 ' }, { t: '15' }, { t: ' 日未完成风险定级' }],
      desc: '建档后 15 日未完成风险定级，无法纳入高风险统计。' },
    { code: 'RG-05', name: '降级后无随访', threshold: '7 日', count: 2, hit: 12, on: true, level: 'mid', to: '属地经办',
      cond: [{ t: '等级下调后 ' }, { t: '7' }, { t: ' 日内无随访记录' }],
      desc: '等级下调后 7 日内无随访记录，防止「一降了之」。' },
    { code: 'RG-06', name: '依据缺失', threshold: '12 个月', count: 1, hit: 31, on: true, level: 'mid', to: '对口部门主管',
      cond: [{ t: '评估材料缺失或出具超过 ' }, { p: 'assessValid' }, { t: '' }],
      desc: '高风险人员评估材料缺失，或出具后超过有效期未更新。' },
    { code: 'RG-07', name: '未指定包联', threshold: '高风险', count: 1, hit: 6, on: true, level: 'low', to: '属地负责人',
      cond: [{ t: '高风险人员未配置包联干部' }],
      desc: '高风险人员必须配置包联干部，缺失即预警。' },
    { code: 'RG-08', name: '跨区流动', threshold: '30 日', count: 0, hit: 0, on: false, board: false, level: 'mid', to: '属地经办',
      cond: [{ t: '实际居住地迁出本区超过 ' }, { t: '30' }, { t: ' 日' }],
      desc: '人员实际居住地迁出本区，与属地台账不一致（本期未启用）。' },
    { code: 'RG-09', name: '重复建档', threshold: '身份证', count: 0, hit: 0, on: false, board: false, level: 'low', to: '数据管理员',
      cond: [{ t: '同一身份证在建档时命中已有档案' }],
      desc: '同一身份证号在建档时命中已有档案（由导入环节前置拦截，故不发生）。' },
    { code: 'RG-10', name: '越权访问尝试', threshold: '5 次 / 30 分钟', count: 0, hit: 3, on: true, level: 'high', to: '安全审计员',
      cond: [{ t: '连续 ' }, { t: '5' }, { t: ' 次越权即冻结 ' }, { t: '30' }, { t: ' 分钟' }],
      desc: '连续越权访问达阈值即冻结账号并推送安全管理员与审计员。' },
    { code: 'RG-11', name: '数据报送缺项', threshold: '缺失率 > 2%', count: 0, hit: 5, on: true, board: false, level: 'mid', to: '数据管理员',
      cond: [{ t: '部门必填字段缺失率 > ' }, { t: '2%' }],
      desc: '部门报送数据必填字段缺失率超过阈值即预警，推送数据管理员催办。' },
    { code: 'RG-12', name: '重点时期未零报告', threshold: '每日 20:00', count: 0, hit: 2, on: true, board: false, level: 'mid', to: '属地负责人',
      cond: [{ t: '每日 ' }, { p: 'zeroDue' }, { t: ' 前未提交当日零报告' }],
      desc: '重点时期每日须提交零报告，超过截止时间未提交即预警（一级响应期间按日见面）。' },
    { code: 'RG-13', name: '账号长期未用', threshold: '90 天', count: 0, hit: 0, on: true, board: false, level: 'low', to: '系统管理员',
      cond: [{ t: '账号 ' }, { t: '90' }, { t: ' 天未登录' }],
      desc: '账号连续 90 天未登录自动冻结，名下待办转交主管，防止僵尸账号。' }
  ];
  const RULE_OF = {};
  RULES.forEach(r => { RULE_OF[r.code] = r; });

  const ALERT_SEED = [
    ['走访超期', 'high', '任玉荣', '鼓楼街道', '高风险', '33 天未走访', '鼓楼街道综治中心', '王振国', '已 33 天无走访记录，超过 30 日阈值；该人员同时为双在册、3 标签重点关注对象。'],
    ['走访超期', 'high', '孙宝良', '十里堡镇', '高风险', '31 天未走访', '十里堡镇综治中心', '周立新', '上次走访为电话联系，未入户；系统按「无有效走访」计超期。'],
    ['走访超期', 'mid', '马秀英', '河南寨镇', '高风险', '35 天未走访', '河南寨镇综治中心', '张国庆', '包联干部 10 月 12 日起参加专项工作，台账未及时移交 B 角。'],
    ['走访超期', 'mid', '李长海', '果园街道', '高风险', '42 天未走访', '果园街道综治中心', '刘敏', '本人外出务工未报备，网格员两次上门未遇。'],
    ['走访超期', 'mid', '周文斌', '巨各庄镇', '高风险', '38 天未走访', '巨各庄镇综治中心', '马晓东', '近期因住院治疗中断走访，需补录医疗机构信息。'],
    ['走访超期', 'low', '吴淑芬', '太师屯镇', '高风险', '47 天未走访', '太师屯镇综治中心', '王海峰', '本人长期在城区子女家中居住，属地与实际居住地不一致。'],
    ['失访 / 拒访', 'high', '李长海', '果园街道', '待核实', '40 天未接触', '果园街道综治中心', '刘敏', '连续 2 次拒绝入户，等级为「风险不详」，需属地联合精防医生再访。'],
    ['失访 / 拒访', 'high', '赵德海', '鼓楼街道', '高风险', '两次拒访', '鼓楼街道综治中心', '王振国', '本人明确拒绝见面，仅接受电话沟通，已按要求记录并上报。'],
    ['失访 / 拒访', 'mid', '陈国华', '溪翁庄镇', '高风险', '失联 26 天', '溪翁庄镇综治中心', '郑海燕', '预留电话停机，需公安侧协助核查常住地址。'],
    ['双在册未确认', 'mid', '任玉荣', '鼓楼街道', '高风险', '待确认 4 天', '区卫健委', '孙敏', '公安侧已确认、卫健侧未确认，任务超 3 日未闭环；管控标准已按较高等级执行。'],
    ['双在册未确认', 'mid', '马春霞', '檀营地区', '高风险', '待确认 5 天', '区卫健委', '孙敏', '卫健侧在册为严重精神障碍，公安侧为扬言类，双确认任务在卫健侧待办。'],
    ['未定级超期', 'mid', '马秀英', '河南寨镇', '待核实', '21 天未定级', '区委政法委', '陈志远', '建档 21 天仍未定级，无法纳入高风险统计，请主责部门补定级。'],
    ['未定级超期', 'mid', '金凤兰', '不老屯镇', '待核实', '18 天未定级', '区委政法委', '陈志远', '部门侧台账仅有姓名与身份证，缺少风险描述材料。'],
    ['未定级超期', 'low', '于长江', '新城子镇', '待核实', '16 天未定级', '区委政法委', '陈志远', '新转入人员，等待司法所出具评估意见。'],
    ['降级后无随访', 'mid', '刘桂兰', '密云镇', '中风险', '降级 9 天无随访', '密云镇综治中心', '周文彬', '10 月 31 日由高风险下调为中风险，至今无随访记录。'],
    ['降级后无随访', 'low', '张宝良', '东邵渠镇', '中风险', '降级 11 天无随访', '东邵渠镇综治中心', '周文彬', '下调依据为连续 6 个月无异常，需补首次随访。'],
    ['依据缺失', 'mid', '王秀兰', '石城镇', '高风险', '依据缺失', '石城镇综治中心', '赵鹏', '高风险但未上传诊断证明或法律文书，需主责部门补充评估依据。'],
    ['未指定包联', 'low', '郑铁柱', '北庄镇', '高风险', '未指定包联', '北庄镇综治中心', '孙志刚', '新转入人员尚未指派包联干部，系统按「高风险必配」规则预警。']
  ];

  const alerts = ALERT_SEED.map((a, i) => {
    const p = bindPerson(a[2], a[3]);
    return {
      id: 'AL-2026' + (i < 12 ? '1110' : '1109') + '-' + String(20 - i).padStart(3, '0'),
      rule: a[0],
      urgency: a[1],
      who: p ? p.name : a[2],
      town: a[3],
      levelName: p ? levelOf(p.level).name : a[4],
      metric: a[5],
      dept: a[6],
      owner: a[7],
      desc: a[8],
      created: (i < 12 ? '2026-11-10 06:00' : '2026-11-09 06:00'),
      status: '待处置',
      personId: p ? p.id : ''
    };
  });

  /* ---------- 8. 调整审批（5 条待审批） ---------- */
  const approvals = [
    { id: 'APP-20261111-001', personId: '', name: '周文斌', town: '巨各庄镇', deptLevel: '中风险', curLevel: 'mid', toLevel: 'low', applicant: '马晓东', applicantDept: '巨各庄镇综治中心', time: '2026-11-11 10:26', reason: '本人住院治疗三个月，病情稳定已出院，家庭监护到位，近 60 日无涉访记录，建议下调为低风险转入常规随访。', evidence: ['出院小结.pdf', '季度评估意见书.docx', '家庭监护承诺书.pdf'], status: '待审批', urgent: false },
    { id: 'APP-20261110-004', personId: '', name: '高振山', town: '十里堡镇', deptLevel: '高风险', curLevel: 'high', toLevel: 'mid', applicant: '李明', applicantDept: '十里堡镇司法所', time: '2026-11-10 08:42', reason: '社区矫正期满，连续 6 个月无违规记录，建议下调为中风险并转入常规随访。', evidence: ['社区矫正期满证明.pdf', '季度评估意见书.docx', '近 6 个月走访记录.xlsx'], status: '待审批', urgent: false },
    { id: 'APP-20261110-003', personId: '', name: '马春霞', town: '檀营地区', deptLevel: '高风险', curLevel: 'high', toLevel: 'high2', applicant: '孙敏', applicantDept: '区卫健委精防办', time: '2026-11-10 08:05', reason: '近期出现明显被害妄想并拒服药，精防医生评估建议上调为极高风险，落实 24 小时监护。', evidence: ['精神专科诊断证明.pdf', '应急处置记录.pdf', '监护人承诺书.pdf'], status: '待审批', urgent: true },
    { id: 'APP-20261109-011', personId: '', name: '陈国华', town: '溪翁庄镇', deptLevel: '中风险', curLevel: 'high', toLevel: 'mid', applicant: '郑海燕', applicantDept: '溪翁庄镇综治中心', time: '2026-11-09 16:20', reason: '本人已稳定就业 12 个月，无新的扬言记录，建议下调为中风险。', evidence: ['就业单位证明.pdf', '派出所无异常记录证明.pdf'], status: '待审批', urgent: false },
    { id: 'APP-20261109-010', personId: '', name: '刘桂兰', town: '密云镇', deptLevel: '高风险', curLevel: 'high2', toLevel: 'high', applicant: '陈志远', applicantDept: '区委政法委 · 政法委主管', time: '2026-11-09 11:10', reason: '住院治疗期满出院，病情稳定，建议由极高风险下调为高风险；本单由政法委主管发起，按「发起人回避」规则本人不得自审。', evidence: ['出院小结.pdf', '主治医师意见.pdf'], status: '待审批', urgent: false },
    { id: 'APP-20261108-007', personId: '', name: '吴淑芬', town: '太师屯镇', deptLevel: '待核实', curLevel: 'unknown', toLevel: 'high', applicant: '王海峰', applicantDept: '太师屯镇综治中心', time: '2026-11-08 09:35', reason: '长期居住城区未报备，经核查确认风险等级，申请由待核实调整为高风险并纳入管控。', evidence: ['核查走访记录.pdf'], status: '待审批', urgent: false }
  ].map(a => {
    const p = bindPerson(a.name, a.town, [a.name === '高振山' ? '社区矫正' : '严重精神障碍']);
    if (!p) return a;
    a.personId = p.id;
    a.name = p.name;
    a.town = p.town;
    /* 原等级沿用申请单声明的「部门原等级」，不再被台账当前等级覆盖：
       否则会出现「高风险 → 高风险」这类无变动的空申请（如待核实→高风险被抹平）。 */
    return a;
  });

  /* ---------- 9. 盲区（三类去重 887） ---------- */
  const blind = {
    total: 887,
    groups: [
      { key: 'dual', name: '双在册（责任交叉）', count: stats.dual, desc: '同一人员在两个及以上部门台账在册，管控责任归属未明确' },
      { key: 'multi', name: '多重标签人员', count: stats.multi, desc: '同一人员叠加 2 个以上标签，需按「就高不就低」统一标准' },
      { key: 'unknown', name: '待核实（依据缺失）', count: stats.unknown, desc: '已建档但未定级或缺少评估依据，无法纳入高风险统计' }
    ]
  };

  /* ---------- 10. 数据导入批次 ---------- */
  const imports = [
    { id: 'IM-20261111-01', name: '公安分局_增量推送_1111.json', dept: '公安分局', time: '2026-11-11 10:05', total: 4, ok: 4, dup: 0, fail: 0, operator: '系统接入', status: '已完成' },
    { id: 'IM-20261110-03', name: '公安分局_政保重点人_1110.xlsx', dept: '公安分局', time: '2026-11-10 07:12', total: 87, ok: 71, dup: 12, fail: 4, operator: '陈志远', status: '已完成' },
    { id: 'IM-20261110-02', name: '卫健委_严重精神障碍_1110.xlsx', dept: '区卫健委', time: '2026-11-10 06:50', total: 64, ok: 60, dup: 3, fail: 1, operator: '孙敏', status: '已完成' },
    { id: 'IM-20261109-01', name: '司法局_社区矫正_1109.csv', dept: '区司法局', time: '2026-11-09 17:03', total: 42, ok: 40, dup: 2, fail: 0, operator: '李明', status: '已完成' },
    { id: 'IM-20261105-02', name: '信访办_涉访人员_1105.xlsx', dept: '区信访办', time: '2026-11-05 10:26', total: 118, ok: 104, dup: 11, fail: 3, operator: '陈志远', status: '已完成' },
    { id: 'IM-20261103-01', name: '公安分局_吸毒人员_1103.xlsx', dept: '公安分局', time: '2026-11-03 15:41', total: 56, ok: 52, dup: 4, fail: 0, operator: '陈志远', status: '已完成' }
  ];

  /* ---------- 11. 重点时期管控 ----------
     应见名单口径（v2）：应见 = 该镇街台账全员，逐人可下钻。
     原 412 口径按权重摊派，其中古北口（13>12）、冯家峪（12>11）、大城子（11>10）、
     东邵渠（10>9）4 个镇街的应见数超过台账人数，按台账人数封顶后
     412 - 4 = 408，且每个人都对应到 DATA.persons 里的一条真实档案。 */
  const wartime = {
    title: '2026 年冬季安全稳定管控期',
    name: '重点时期管控（2026-11-01 至 2026-12-31）',
    start: '2026-11-01', end: '2026-12-31', days: 61, dayNow: 10,
    should: 0, met: 0, missing: 0,
    tasks: [
      { town: '鼓楼街道', should: 65, met: 58, missing: 7, officer: '王振国' },
      { town: '果园街道', should: 60, met: 54, missing: 6, officer: '李春燕' },
      { town: '檀营地区', should: 27, met: 24, missing: 3, officer: '孙志刚' },
      { town: '密云镇', should: 25, met: 22, missing: 3, officer: '周文彬' },
      { town: '溪翁庄镇', should: 22, met: 20, missing: 2, officer: '郑海燕' },
      { town: '十里堡镇', should: 21, met: 19, missing: 2, officer: '周立新' },
      { town: '河南寨镇', should: 20, met: 18, missing: 2, officer: '张国庆' },
      { town: '巨各庄镇', should: 19, met: 17, missing: 2, officer: '马晓东' },
      { town: '穆家峪镇', should: 18, met: 16, missing: 2, officer: '赵鹏' },
      { town: '太师屯镇', should: 17, met: 15, missing: 2, officer: '王海峰' },
      { town: '西田各庄镇', should: 16, met: 14, missing: 2, officer: '周立新' },
      { town: '高岭镇', should: 15, met: 13, missing: 2, officer: '孙志刚' },
      { town: '不老屯镇', should: 15, met: 13, missing: 2, officer: '张国庆' },
      { town: '古北口镇', should: 13, met: 12, missing: 1, officer: '郑海燕' },
      { town: '冯家峪镇', should: 12, met: 11, missing: 1, officer: '马晓东' },
      { town: '石城镇', should: 11, met: 10, missing: 1, officer: '赵鹏' },
      { town: '大城子镇', should: 11, met: 10, missing: 1, officer: '李春燕' },
      { town: '东邵渠镇', should: 10, met: 9, missing: 1, officer: '周文彬' },
      { town: '北庄镇', should: 8, met: 7, missing: 1, officer: '孙志刚' },
      { town: '新城子镇', should: 7, met: 6, missing: 1, officer: '王海峰' }
    ]
  };

  /* 应见数按该镇街台账人数封顶 → 20 镇街合计 408，未见面合计 44 */
  (function () {
    let shouldAll = 0, missAll = 0;
    wartime.tasks.forEach(t => {
      const pool = persons.filter(p => p.town === t.town).length;
      t.should = Math.min(t.should, pool);
      t.missing = Math.min(t.missing, Math.max(0, t.should - 1));
      t.met = t.should - t.missing;
      shouldAll += t.should;
      missAll += t.missing;
    });
    wartime.should = shouldAll;
    wartime.missing = missAll;
    wartime.met = shouldAll - missAll;
  })();

  /* ---------- 11b. 重点时期 · 未见面原因 / 响应等级 / 时期参数 ---------- */
  /* 未见面原因字典：既是「未见面原因分布」卡片的图例，也是回填弹窗的必选项。
     基准分布 14/9/8/6/7 = 44，与台账逐人绑定（见 wtReasonOf）。 */
  const WT_REASONS = [
    { key: 'away', name: '外出未归', color: '#1e6cbf', base: 14, desc: '本人长期外出务工或投亲，属地无法当面见面；须电话/视频联系并留存通话记录' },
    { key: 'refuse', name: '拒访', color: '#e8830c', base: 9, desc: '本人或家属拒绝见面；须联合民警、村居干部二次上门并全程留痕' },
    { key: 'hospital', name: '住院治疗', color: '#5d7d9c', base: 8, desc: '在院治疗期间凭诊断证明视同已见面，出院后 7 日内须补访一次' },
    { key: 'lost', name: '失联', color: '#d92d20', base: 6, desc: '电话与住址均无法联系；须报属地派出所协查，并纳入「失访」预警台账' },
    { key: 'other', name: '其他', color: '#aeb4bc', base: 7, desc: '含临时看护、跨区协管、疫情隔离等情形；须在原因说明中写明具体情况' }
  ];
  const WT_REASON_OF = WT_REASONS.reduce((a, r) => { a[r.key] = r; return a; }, {});

  /* 见面方式 / 对象 / 结果：回填弹窗的下拉项，也是基线数据的取值域 */
  const WT_WAYS = ['入户走访', '联合面访', '社区见面', '视频通话', '电话联系'];
  const WT_TARGETS = ['本人', '本人 + 家属', '本人 + 监护人', '本人 + 精防医生', '家属（本人外出）'];
  const WT_RESULTS = ['情况稳定', '情绪波动，已疏导', '已落实监护措施', '反馈正常，无需处置', '已提醒按时服药'];
  /* 「其他」原因的基线说明：本身即要求必填，基线逐人给出可读情形，避免空值卡住提交 */
  const WT_OTHER_MEMO = [
    '本人由亲属临时看护，属地已电话核实',
    '跨区协管，属地正在与接收地对接',
    '本人暂住养老机构，见面需预约',
    '因伤在家静养，家属代为见面',
    '外出就医未归，已约定返程后补访',
    '居住地变更未报备，正在核实',
    '本人配合度低，已安排联合上门'
  ];

  /* 响应等级：三档，可在页面配置（增删要求 / 适用时期 / 触发条件） */
  /* 响应等级：结构化档位。过去「见面频次 / 报告节奏 / 适用时期」都是自由文本，
     无法参与任何计算；现改为枚举 + 自定义数值，全站按 visitEvery / reportEvery
     / reportDue 真正参与见面时限、零报告截止与催办判定。
       visitEvery  见面频次（每 N 日，1 = 每日）
       reportEvery 报告节奏（每 N 日，1 = 每日零报告）
       reportDue   报告截止时刻 HH:MM
       scope       适用时期（多选枚举） */
  const WT_LEVELS = [
    { key: 'L1', name: '一级', color: 'tag-red', visitEvery: 1, reportEvery: 1, reportDue: '08:00', scope: ['两会', '国庆', '重大活动', '敏感节点'], active: true },
    { key: 'L2', name: '二级', color: 'tag-orange', visitEvery: 7, reportEvery: 7, reportDue: '10:00', scope: ['重要节点', '敏感期', '突发事件'], active: false },
    { key: 'L3', name: '三级', color: 'tag-slate', visitEvery: 30, reportEvery: 30, reportDue: '10:00', scope: ['平时'], active: false }
  ];

  /* 等级字段的枚举档位（下拉首选这些规范值，选「自定义」时可填任意整数） */
  const WT_VISIT_STEPS = [
    { v: 1, t: '每日' }, { v: 2, t: '每 2 日' }, { v: 3, t: '每 3 日' },
    { v: 5, t: '每 5 日' }, { v: 7, t: '每周' }, { v: 15, t: '每 15 日' }, { v: 30, t: '每月' }
  ];
  const WT_REPORT_STEPS = [
    { v: 1, t: '每日零报告' }, { v: 2, t: '每 2 日报告' }, { v: 3, t: '每 3 日报告' },
    { v: 5, t: '每 5 日报告' }, { v: 7, t: '周报告' }, { v: 15, t: '半月报告' }, { v: 30, t: '月报告' }
  ];
  const WT_SCOPES = ['两会', '国庆', '重大活动', '敏感节点', '重要节点', '敏感期', '突发事件', '专项攻坚', '平时'];

  /* 结构化等级 → 展示文案：表格、hero、下拉、CSV 全部用这一份，避免各处自己拼串 */
  function wtLevelText(lv) {
    const vn = Math.max(1, Number(lv.visitEvery) || 1);
    const rn = Math.max(1, Number(lv.reportEvery) || 1);
    const due = lv.reportDue || '08:00';
    const visit = vn === 1 ? '每日见面'
      : vn === 7 ? '每周见面'
        : vn === 30 ? '按常规频次（每 30 日）'
          : '每 ' + vn + ' 日见面';
    const report = rn === 1 ? '每日零报告（' + due + ' 前）'
      : rn === 7 ? '周报告（每周一 ' + due + ' 前）'
        : rn === 30 ? '月报告（每月 5 日 ' + due + ' 前）'
          : '每 ' + rn + ' 日报告（' + due + ' 前）';
    const scopeArr = Array.isArray(lv.scope) ? lv.scope : String(lv.scope || '').split(/[\s/、,]+/).filter(Boolean);
    return { visit, report, scopeText: scopeArr.join(' / '), due, visitEvery: vn, reportEvery: rn, scope: scopeArr };
  }

  /* 时期参数：页面「时期配置」读写这一份，hero / KPI / 镇街时限全部联动 */
  const WT_CFG = {
    title: '2026 年冬季安全稳定管控期',
    start: '2026-11-01',
    end: '2026-12-31',
    level: 'L1',
    visitLimit: 1,          // 见面时限（日）—— 默认与一级响应「每日见面」一致
    reportDue: '08:00',     // 零报告截止
    escalateHours: 2,       // 催办升级（小时）
    rosterRule: ['高风险及以上', '双在册', '三重标签'],
    updatedAt: '2026-10-31 17:20',
    updatedBy: '陈志远'
  };

  /* 应见名单逐人展开：该镇街台账人员按「走访间隔最久优先」取前 should 人。
     前 missing 人为未见面（原因按基准分布确定性打散），其余为已见面。 */
  const wtRosterCache = {};
  function wartimeRoster(town) {
    const t = wartime.tasks.find(x => x.town === town);
    if (!t) return [];
    if (wtRosterCache[town]) return wtRosterCache[town].slice();
    const list = persons.filter(p => p.town === town)
      .slice()
      .sort((a, b) => b.visitGap - a.visitGap || a.id.localeCompare(b.id))
      .slice(0, t.should);
    wtRosterCache[town] = list;
    return list.slice();
  }

  /* 44 个未见面名额按基准分布（14/9/8/6/7）确定性打散：
     同一份数据每次刷新分布一致，且每个人落在固定原因上，可逐一追溯。 */
  const WT_REASON_MAP = (function () {
    const bag = [];
    WT_REASONS.forEach(r => { for (let i = 0; i < r.base; i++) bag.push(r.key); });
    const rnd = mulberry32(20261110);
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const tmp = bag[i]; bag[i] = bag[j]; bag[j] = tmp;
    }
    const map = {};
    let k = 0;
    wartime.tasks.forEach(t => {
      wartimeRoster(t.town).slice(0, t.missing).forEach(p => { map[p.id] = bag[k++ % bag.length]; });
    });
    return map;
  })();

  /* 逐人回填基线行：status = met / miss；未见面带原因与复访日期，已见面带方式/对象/结果 */
  const wtRowCache = {};
  function wartimeRows(town) {
    if (wtRowCache[town]) return wtRowCache[town].map(r => Object.assign({}, r));
    const t = wartime.tasks.find(x => x.town === town);
    if (!t) return [];
    const out = wartimeRoster(town).map((p, i) => {
      const rnd = mulberry32((p.id.split('').reduce((a, c) => (Math.imul(a, 31) + c.charCodeAt(0)) >>> 0, 11)));
      const pick = arr => arr[Math.floor(rnd() * arr.length)];
      if (i < t.missing) {
        const rk = WT_REASON_MAP[p.id] || 'other';
        return {
          personId: p.id, status: 'miss', reason: rk,
          way: '', target: '', at: '', result: '',
          due: '2026-11-' + String(13 + (i % 8)).padStart(2, '0'),
          supervise: rk === 'lost' || rk === 'refuse',
          memo: rk === 'other' ? WT_OTHER_MEMO[p.id.charCodeAt(1) % WT_OTHER_MEMO.length] : ''
        };
      }
      return {
        personId: p.id, status: 'met', reason: '',
        way: pick(WT_WAYS), target: pick(WT_TARGETS),
        at: '2026-11-' + String(4 + (i % 6)).padStart(2, '0') + ' ' + String(9 + (i % 8)).padStart(2, '0') + ':' + pick(['10', '25', '40', '55']),
        result: pick(WT_RESULTS), due: '', supervise: false, memo: ''
      };
    });
    wtRowCache[town] = out;
    return out.map(r => Object.assign({}, r));
  }

  /* ---------- 12. 统计分析 ---------- */
  const analytics = {
    trendDays: [/* 近 14 日新增 */ 12, 18, 15, 22, 19, 26, 14, 21, 17, 24, 20, 28, 16, 23],
    trendDates: ['10-28', '10-29', '10-30', '10-31', '11-01', '11-02', '11-03', '11-04', '11-05', '11-06', '11-07', '11-08', '11-09', '11-10'],
    visitTrend: [82, 86, 84, 91, 88, 95, 89, 92, 94, 91, 96, 93, 97, 94],
    deptShare: [
      { name: '公安分局', value: 2284, cls: '#1e6cbf' },
      { name: '区信访办', value: 1642, cls: '#4d8fd2' },
      { name: '区卫健委', value: 1286, cls: '#92bce5' },
      { name: '区司法局', value: 816, cls: '#c6ddf5' }
    ],
    tagTop: TAGS.map((t, i) => ({ name: t.name, value: [986, 742, 318, 226, 512, 486, 364, 402, 318, 274, 96][i] })).sort((a, b) => b.value - a.value),
    levelDist: [
      { name: '极高风险', value: stats.high2, cls: '#9f1d13' },
      { name: '高风险', value: 1444, cls: '#d92d20' },
      { name: '中风险', value: 2284, cls: '#e8833a' },
      { name: '低风险', value: 2646, cls: '#1f9254' },
      { name: '待核实', value: 612, cls: '#c99a06' }
    ]
  };

  /* ---------- 12b. 月度报送（统计分析「月度报送情况」+「生成差异说明」共用） ----------
     应报 / 实报 / 迟报三项与上月同期并列保存：差异说明只做「本月 vs 上月」的
     逐部门对比，不引入任何新的统计口径。 */
  const reportMonthly = {
    month: '2026-11',
    prev: '2026-10',
    due: '2026-11-05',
    rows: [
      { dept: '区公安分局', should: 7, real: 7, late: 0, prevShould: 7, prevReal: 6, prevLate: 1, note: '' },
      { dept: '区卫健委', should: 2, real: 2, late: 0, prevShould: 2, prevReal: 2, prevLate: 0, note: '' },
      { dept: '区信访办', should: 2, real: 2, late: 0, prevShould: 2, prevReal: 2, prevLate: 0, note: '' },
      { dept: '区司法局', should: 2, real: 1, late: 1, lateDays: 3, prevShould: 2, prevReal: 2, prevLate: 0, note: '「社区矫正对象月度台账」11-08 提交，超截止日 3 天；「安置帮教」按期报送' },
      { dept: '区委政法委', should: 2, real: 2, late: 0, prevShould: 2, prevReal: 1, prevLate: 1, note: '' }
    ]
  };

  /* ---------- 13. 角色与字段密级 ---------- */
  const ROLES = {
    leader: {
      key: 'leader', account: 'demo_leader', roleName: '区领导',
      user: '李国栋', title: '区委常委 · 政法委书记', avatar: '李',
      scope: 'all', scopeText: '全区概要 · 身份证掩码',
      fields: { name: 'mask', idNo: 'mask', phone: 'mask', addr: 'trim' },
      /* 区领导：概要查看 + 脱敏导出（不接触明细编辑 / 明文 / 审批 / 配置） */
      can: { approve: false, export: true, exportPlain: false, edit: false, import: false, disclosure: false, config: false }
    },
    admin: {
      key: 'admin', account: 'demo_admin', roleName: '政法委主管',
      user: '陈志远', title: '政法委主管 · 全区', avatar: '陈',
      scope: 'all', scopeText: '全区全字段',
      fields: { name: 'full', idNo: 'full', phone: 'full', addr: 'full' },
      can: { approve: true, export: true, exportPlain: true, edit: true, import: true, disclosure: true, config: true }
    },
    dept: {
      key: 'dept', account: 'demo_dept', roleName: '公安经办',
      user: '赵德海', title: '公安分局 · 政保大队', avatar: '赵',
      scope: 'dept', dept: '公安分局', scopeText: '仅本部门 · 导出受限',
      fields: { name: 'full', idNo: 'mask', phone: 'partial', addr: 'full' },
      can: { approve: false, export: true, exportPlain: false, edit: true, import: true, disclosure: true, config: false }
    }
  };

  /* 字段渲染：按角色决定明文 / 掩码 / 隐藏 */
  function field(roleKey, fieldName, person) {
    const role = ROLES[roleKey] || ROLES.admin;
    const mode = role.fields[fieldName] || 'full';
    const raw = {
      name: person.name, idNo: person.idNo, phone: person.phone, addr: person.addr
    }[fieldName];
    if (!raw) return { text: '—', masked: false };
    if (mode === 'full') return { text: raw, masked: false };
    if (fieldName === 'name') return { text: maskName(raw), masked: true };
    if (fieldName === 'idNo') return { text: maskId(raw), masked: true };
    if (fieldName === 'phone') return mode === 'mask' ? { text: maskPhone(raw), masked: true } : { text: maskPhone(raw), masked: true };
    if (fieldName === 'addr') {
      return mode === 'trim'
        ? { text: raw.replace(/\s\d+ 号楼 .*$/, ' ****'), masked: true }
        : { text: raw, masked: false };
    }
    return { text: raw, masked: false };
  }

  /* 数据范围：公安经办仅见本部门来源人员 */
  function scoped(roleKey, list) {
    const role = ROLES[roleKey] || ROLES.admin;
    if (role.scope !== 'dept') return list;
    return list.filter(p => p.dept === role.dept);
  }

  /* ---------- 14. 派生查询 ---------- */
  /* 未定级人员（U 前缀）不在 persons 内，需一并回落，否则一人一档会串到第一个人 */
  function personById(id) {
    return persons.find(p => p.id === id) || unrated.find(p => p.id === id) || persons[0];
  }
  function personByNo(no) {
    return persons.find(p => p.no === no) || unrated.find(p => p.no === no) || persons[0];
  }

  /* 重点时期「应见未见」人员：按镇街 missing 数从台账确定性选取（走访间隔最久优先）。
     board 最久未见面 / wartime 督办弹窗共用此源，保证两处数据一致 */
  function wartimeUnseen(town) {
    const miss = {};
    wartimeRows(town).filter(r => r.status === 'miss').forEach(r => { miss[r.personId] = 1; });
    return persons.filter(p => miss[p.id]);
  }
  function wartimeUnseenAll() {
    const rows = [];
    wartime.tasks.forEach(t => {
      const order = {};
      wartimeRows(t.town).filter(r => r.status === 'miss').forEach((r, i) => { order[r.personId] = i; });
      persons.filter(p => order[p.id] != null)
        .sort((a, b) => order[a.id] - order[b.id])
        .forEach(p => rows.push({ person: p, town: t.town }));
    });
    return rows.sort((a, b) => b.person.visitGap - a.person.visitGap);
  }

  /* 走访记录（按人稳定生成） */
  function visitsOf(person) {
    const r = mulberry32(person.id.split('').reduce((a, c) => a + c.charCodeAt(0), 7));
    const out = [];
    const ways = ['入户走访', '电话联系', '联合面访', '视频通话', '社区见面'];
    const results = ['情况稳定', '情绪波动，已疏导', '本人不在家，预约再访', '家属反馈正常', '已落实监护措施'];
    let gap = person.visitGap;
    for (let i = 0; i < 6; i++) {
      out.push({
        date: dateBefore(gap),
        way: ways[Math.floor(r() * ways.length)],
        by: person.officer,
        result: results[Math.floor(r() * results.length)],
        days: gap
      });
      gap += 28 + Math.floor(r() * 22);
    }
    return out;
  }

  /* 变动记录 */
  function historyOf(person) {
    const lv = levelOf(person.level).name;
    return [
      { time: person.lastVisit, act: '走访登记', detail: '采取入户走访，' + (person.noBasis ? '未能提供稳定情况说明' : '情况稳定'), by: person.officer },
      { time: '2026-09-18', act: '等级评估', detail: '经季度评估维持「' + lv + '」', by: person.officer },
      { time: '2026-06-02', act: '等级调整', detail: '由「中风险」上调为「' + lv + '」，依据：新增' + person.tags[0] + '标签', by: '李明' },
      { time: person.since + '-01', act: '建档', detail: '来源：' + person.source + '，身份证号归并为一人一档', by: '系统' }
    ];
  }

  /* 包联与责任 */
  function dutyOf(person) {
    return [
      { role: '包联干部', name: person.officer, dept: person.town + (person.town.endsWith('街道') || person.town.endsWith('地区') ? '办事处' : '政府'), title: person.officerTitle, phone: '139****' + String(1000 + person.name.charCodeAt(0)).slice(0, 4) },
      { role: '主责部门', name: person.dept, dept: '信息来源部门', title: '台账报送与依据出具', phone: '—' },
      { role: '联动民警', name: '辖区派出所', dept: person.town + '派出所', title: '协助核查与应急处置', phone: '—' },
      { role: '精防医生', name: person.tags.includes('严重精神障碍') ? '社区精防医生' : '—', dept: '区卫健委', title: '精神障碍患者随访管理', phone: '—' }
    ];
  }

  /* 导入批次真实落库：追加到台账并同步汇总口径（演示环境内存生效，
     跨页持久化由 store.js 的 importedPersons 负责重放） */
  function addPersons(list) {
    let serial = persons.length + 1000;
    const added = list.map(r => {
      serial += 1;
      const birth = r.idNo ? r.idNo.slice(6, 10) + '-' + r.idNo.slice(10, 12) + '-' + r.idNo.slice(12, 14) : '';
      const t = r.town && townOf(r.town) ? townOf(r.town) : null;
      const p = {
        id: 'P' + String(serial), no: 'MY-2026-' + String(serial).padStart(6, '0'),
        name: r.name, gender: r.idNo && Number(r.idNo[16]) % 2 === 1 ? '男' : '女',
        birth, age: birth ? 2026 - Number(birth.slice(0, 4)) : 0,
        idNo: r.idNo, phone: r.phone || '', town: t ? t.key : (r.town || '待归属'),
        village: '—', addr: r.addr || '', tags: r.tags && r.tags.length ? r.tags : ['待归类'],
        level: r.level || 'unknown', dual: false, multi: (r.tags || []).length > 1,
        officer: t ? t.officer : '待指派', officerTitle: t ? t.title : '',
        dept: r.dept || '区政法委', source: (r.dept || '区政法委') + '台账·导入',
        status: '在管', lastVisit: null, visitGap: 0, visitTotal: 0,
        since: '2026-11', watch: false, noBasis: true, imported: true
      };
      persons.push(p);
      return p;
    });
    stats.inRegister += added.length;
    recalcStats();
    return added;
  }

  /* 汇总口径重算：导入 / 审批改级后调用，保证各页读到同一份数
     说明：dual / multi / 待核实 属「盲区识别」口径，按上期快照冻结，不随导入即时变动；
          在册总数与高风险及以上为实时口径，逐次重算。 */
  function recalcStats() {
    stats.highPlus = persons.filter(x => x.level === 'high' || x.level === 'high2').length;
    stats.high2 = persons.filter(x => x.level === 'high2').length;
    stats.percentHigh = stats.inRegister ? +(stats.highPlus / stats.inRegister * 100).toFixed(1) : 0;
    return stats;
  }

  /* ============================================================
     系统管理 · 演示数据（SYS_*）
     ------------------------------------------------------------
     口径：9 类角色 / 5 组 48 项权限 / 9 字段密级 / 47 个账号 /
          13 部字典 / 7 项阈值 / 4 档审批路由 / 7 日命中 / 6 条安全事件链路
     说明：SYS_ROLES 是「被管理的角色目录」，ROLES 是「当前登录身份」，
          两套不混用，避免切角色演示时把权限矩阵改花。
     ============================================================ */

  /* ---------- 1. 九类角色（三员分立） ---------- */
  const SYS_ROLES = [
    { key: 'R1', name: '区委书记 / 区长', tier: '一级 · 区级决策', tierTip: '全区只读', users: 2, scope: '全区概要 · 只读 · 姓名掩码', note: '只看概要，不看个案明细' },
    { key: 'R2', name: '政法委主管', tier: '二级 · 区级管理', tierTip: '科长 / 主任归此级', users: 6, scope: '全区 · 全字段', note: '全区全字段 · 终审与统筹' },
    { key: 'R3', name: '部门科长 / 主任', tier: '二级 · 区级管理', tierTip: '科长 / 主任归此级', users: 9, scope: '本部门全字段 · 本类别全区统计', note: '本部门可写 · 本类别可统计' },
    { key: 'R4', name: '部门经办', tier: '三级 · 部门与属地执行', tierTip: '仅本部门可写', users: 12, scope: '本部门来源人员', note: '仅本部门来源 · 不可跨属地' },
    { key: 'R5', name: '属地经办', tier: '三级 · 部门与属地执行', tierTip: '仅本部门可写', users: 10, scope: '本辖区 · 可写走访', note: '本辖区台账与走访登记' },
    { key: 'R6', name: '属地负责人', tier: '三级 · 部门与属地执行', tierTip: '仅本部门可写', users: 5, scope: '本辖区审核', note: '本辖区审核 · 零报告提交' },
    { key: 'R7', name: '系统管理员', tier: '系统管理 · 三员分立', tierTip: '不触业务', users: 1, scope: '无业务数据权限', note: '账号与运维 · 不可查看业务明细', trio: true },
    { key: 'R8', name: '安全管理员', tier: '系统管理 · 三员分立', tierTip: '不触业务', users: 1, scope: '无业务数据权限', note: '权限与安全策略 · 不运维不看明细', trio: true },
    { key: 'R9', name: '安全审计员', tier: '系统管理 · 三员分立', tierTip: '不触业务', users: 1, scope: '仅日志', note: '只读日志与校验报告', trio: true }
  ];
  const SYS_ROLE_OF = {};
  SYS_ROLES.forEach(r => { SYS_ROLE_OF[r.key] = r; });

  /* ---------- 2. 权限目录：5 组 48 项（权限码仅作内部键，界面只显示中文） ---------- */
  const SYS_PERMS = [
    { g: '台账与档案', items: [
      { code: 'person:list', name: '人员列表' }, { code: 'person:view', name: '查看人员' },
      { code: 'person:idcard:plain', name: '身份证明文' }, { code: 'person:create', name: '新增人员' },
      { code: 'person:update', name: '修改人员' }, { code: 'person:update:street', name: '跨属地修改' },
      { code: 'person:reduce', name: '人员减册' }, { code: 'person:restore', name: '恢复入册' },
      { code: 'tag:create', name: '新增标签' }, { code: 'tag:remove', name: '移除标签' },
      { code: 'tag:approve:overflow', name: '超标标签审批' }, { code: 'tag:view:cross_dept', name: '跨部门查看标签' },
      { code: 'visit:create', name: '新增走访' }, { code: 'visit:view', name: '查看走访' }
    ]},
    { g: '风险等级', items: [
      { code: 'risk:adjust:up', name: '上调等级' }, { code: 'risk:adjust:down', name: '下调等级' },
      { code: 'risk:approve:l1', name: '一级审批' }, { code: 'risk:approve:l2', name: '二级审批' },
      { code: 'risk:approve:l3', name: '三级审批' }, { code: 'risk:approve:l4', name: '四级审批' },
      { code: 'risk:history:view', name: '查看调整历史' }, { code: 'risk:history:export', name: '导出调整历史' }
    ]},
    { g: '查询与导入导出', items: [
      { code: 'query:execute', name: '执行查询' }, { code: 'query:tag_combo', name: '标签组合查询' },
      { code: 'export:masked', name: '脱敏导出' }, { code: 'export:plain', name: '明文导出' },
      { code: 'export:plain:apply', name: '明文导出申请' }, { code: 'export:plain:approve', name: '明文导出审批' },
      { code: 'export:minor', name: '未成年人导出' }, { code: 'import:execute', name: '执行导入' },
      { code: 'import:mapping', name: '配置字段映射' }
    ]},
    { g: '驾驶舱与预警', items: [
      { code: 'dashboard:view', name: '查看驾驶舱' }, { code: 'dashboard:bigscreen', name: '大屏模式' },
      { code: 'dashboard:drill:street', name: '下钻至镇街' }, { code: 'dashboard:drill:community', name: '下钻至社区' },
      { code: 'dashboard:drill:list', name: '下钻至名单' }, { code: 'dashboard:wartime', name: '重点时期视图' },
      { code: 'wartime:config', name: '重点时期配置' }, { code: 'alert:view', name: '查看预警' },
      { code: 'alert:handle', name: '处置预警' }, { code: 'alert:assign', name: '指派预警' },
      { code: 'alert:ignore', name: '忽略预警' }, { code: 'alert:rule:config', name: '预警规则配置' }
    ]},
    { g: '系统管理（默认拒绝）', items: [
      { code: 'sys:user:manage', name: '账号管理' }, { code: 'sys:role:manage', name: '角色管理' },
      { code: 'sys:perm:assign', name: '权限分配' }, { code: 'sys:audit:view', name: '审计查看' },
      { code: 'sys:backup:exec', name: '备份执行' }
    ]}
  ];
  const SYS_PERM_GROUPS = SYS_PERMS.map(g => g.g);
  const SYS_PERM_ALL = SYS_PERMS.reduce((a, g) => a.concat(g.items.map(i => i.code)), []);
  const SYS_PERM_NAME = {};
  SYS_PERMS.forEach(g => g.items.forEach(i => { SYS_PERM_NAME[i.code] = i.name; }));

  /* ---------- 3. 角色权限矩阵：on 允许 / half 受限需审批 / off 禁止 ---------- */
  const SYS_ROLE_PERMS = (function () {
    const PRESET = {
      R1: { on: ['person:list', 'person:view', 'dashboard:view', 'dashboard:bigscreen', 'dashboard:drill:street', 'dashboard:drill:community', 'alert:view'] },
      R2: {
        on: ['person:list', 'person:view', 'person:create', 'person:update', 'person:update:street', 'person:restore',
          'tag:create', 'tag:approve:overflow', 'tag:view:cross_dept', 'visit:create', 'visit:view',
          'risk:adjust:up', 'risk:adjust:down', 'risk:approve:l1', 'risk:approve:l2', 'risk:approve:l3',
          'risk:history:view', 'risk:history:export', 'query:execute', 'query:tag_combo', 'export:masked',
          'export:plain:apply', 'import:execute', 'import:mapping', 'dashboard:view', 'dashboard:bigscreen',
          'dashboard:drill:street', 'dashboard:drill:community', 'dashboard:drill:list', 'dashboard:wartime',
          'wartime:config', 'alert:view', 'alert:handle', 'alert:assign', 'alert:ignore', 'alert:rule:config'],
        half: ['person:idcard:plain', 'person:reduce', 'tag:remove', 'risk:approve:l4', 'export:plain', 'export:plain:approve', 'export:minor']
      },
      R3: {
        on: ['person:list', 'person:view', 'person:create', 'person:update', 'tag:create', 'visit:create', 'visit:view',
          'risk:adjust:up', 'risk:adjust:down', 'risk:approve:l3', 'risk:approve:l4', 'risk:history:view',
          'query:execute', 'query:tag_combo', 'export:masked', 'dashboard:view', 'dashboard:drill:street',
          'dashboard:drill:community', 'dashboard:drill:list', 'alert:view', 'alert:handle', 'alert:assign'],
        half: ['person:idcard:plain', 'tag:remove', 'export:plain:apply']
      },
      R4: {
        on: ['person:list', 'person:view', 'person:create', 'person:update', 'visit:create', 'visit:view',
          'risk:adjust:up', 'risk:history:view', 'query:execute', 'export:masked', 'dashboard:view', 'alert:view', 'alert:handle'],
        half: ['person:idcard:plain', 'export:plain:apply']
      },
      R5: {
        on: ['person:list', 'person:view', 'visit:create', 'visit:view', 'query:execute', 'export:masked',
          'dashboard:view', 'dashboard:drill:street', 'dashboard:drill:community', 'alert:view', 'alert:handle'],
        half: ['person:idcard:plain', 'export:plain:apply']
      },
      R6: {
        on: ['person:list', 'person:view', 'person:update', 'visit:view', 'query:execute', 'export:masked',
          'dashboard:view', 'dashboard:drill:street', 'dashboard:drill:community', 'alert:view', 'alert:handle', 'alert:assign'],
        half: ['person:idcard:plain', 'risk:approve:l4']
      },
      R7: { on: ['sys:user:manage', 'sys:backup:exec'], half: [] },
      R8: { on: ['sys:role:manage', 'sys:perm:assign'], half: [] },
      R9: { on: ['sys:audit:view'], half: [] }
    };
    const out = {};
    SYS_ROLES.forEach(r => {
      const p = PRESET[r.key] || { on: [], half: [] };
      const m = {};
      SYS_PERM_ALL.forEach(c => {
        m[c] = (p.half || []).indexOf(c) > -1 ? 'half' : ((p.on || []).indexOf(c) > -1 ? 'on' : 'off');
      });
      out[r.key] = m;
    });
    return out;
  })();

  /* ---------- 4. 字段密级（9 字段 × 9 角色） ---------- */
  const SYS_FIELDS = [
    { key: 'name', name: '姓名', level: 'L2', hint: '掩码保留姓氏' },
    { key: 'idNo', name: '身份证号', level: 'L3', hint: '仅前六后四' },
    { key: 'phone', name: '联系电话', level: 'L3', hint: '中间四位掩码' },
    { key: 'domicile', name: '户籍地址', level: 'L2', hint: '按角色截断' },
    { key: 'addr', name: '现住址', level: 'L2', hint: '可截断至社区' },
    { key: 'reason', name: '列入原因', level: 'L4', hint: '业务敏感' },
    { key: 'basis', name: '评估依据', level: 'L4', hint: '业务敏感' },
    { key: 'visit', name: '走访内容', level: 'L4', hint: '含家属信息' },
    { key: 'special', name: '特殊类别明细', level: 'L4', hint: '卫健 / 公安内控' }
  ];
  /* 明 / 掩 / 申（需申请）/ 隐 / 本部门 / 辖区明 */
  const SYS_MASK = {
    name: { R1: '掩', R2: '明', R3: '明', R4: '明', R5: '明', R6: '明', R7: '隐', R8: '隐', R9: '隐' },
    idNo: { R1: '掩', R2: '申', R3: '申', R4: '掩', R5: '掩', R6: '申', R7: '隐', R8: '隐', R9: '隐' },
    phone: { R1: '掩', R2: '明', R3: '明', R4: '明', R5: '明', R6: '明', R7: '隐', R8: '掩', R9: '隐' },
    domicile: { R1: '隐', R2: '明', R3: '明', R4: '明', R5: '明', R6: '明', R7: '隐', R8: '隐', R9: '隐' },
    addr: { R1: '掩', R2: '明', R3: '明', R4: '明', R5: '明', R6: '明', R7: '隐', R8: '掩', R9: '隐' },
    reason: { R1: '隐', R2: '明', R3: '本部门', R4: '本部门', R5: '隐', R6: '本部门', R7: '隐', R8: '隐', R9: '隐' },
    basis: { R1: '隐', R2: '明', R3: '本部门', R4: '本部门', R5: '掩', R6: '本部门', R7: '隐', R8: '隐', R9: '隐' },
    visit: { R1: '掩', R2: '明', R3: '明', R4: '明', R5: '辖区明', R6: '明', R7: '隐', R8: '隐', R9: '隐' },
    special: { R1: '隐', R2: '明', R3: '本部门', R4: '本部门', R5: '隐', R6: '本部门', R7: '隐', R8: '隐', R9: '隐' }
  };
  const MASK_MODES = ['明', '掩', '申', '隐', '本部门', '辖区明'];

  /* ---------- 5. 47 个账号（与九类角色人数逐项对账：2+6+9+12+10+5+1+1+1 = 47） ---------- */
  const SYS_ACCOUNTS = [
    ['李国栋', 'liguodong', '区委', 'R1', '全区概要 · 只读', '今天 07:20', '正常'],
    ['王振山', 'wangzs', '区政府', 'R1', '全区概要 · 只读', '昨天 18:05', '正常'],
    ['陈志远', 'chenzhiyuan', '区委政法委', 'R2', '全区 · 全字段', '今天 08:52', '正常'],
    ['赵文军', 'zhaowj', '区委政法委', 'R2', '全区 · 全字段', '今天 09:31', '正常'],
    ['钱志强', 'qianzq', '区委政法委', 'R2', '全区 · 全字段', '昨天 17:12', '正常'],
    ['孙丽华', 'sunlh', '区信访办', 'R2', '全区 · 全字段', '今天 08:05', '正常'],
    ['周文涛', 'zhouwt', '区卫健委', 'R2', '全区 · 全字段', '11-09 16:40', '正常'],
    ['郑海燕', 'zhenghy', '区司法局', 'R2', '全区 · 全字段', '11-08 09:22', '正常'],
    ['周敏', 'zhoumin', '区信访办', 'R3', '信访来源 + 本类别全区', '今天 08:20', '正常'],
    ['王立', 'wangli', '区公安分局', 'R3', '公安来源 + 本类别全区', '今天 09:02', '正常'],
    ['孙敏', 'sunmin', '区卫健委', 'R3', '卫健来源 + 本类别全区', '昨天 17:34', '正常'],
    ['李明', 'liming', '区司法局', 'R3', '司法来源 + 本类别全区', '今天 07:55', '正常'],
    ['张国庆', 'zhanggq', '河南寨镇', 'R3', '本镇街 + 本类别全区', '昨天 16:18', '正常'],
    ['刘敏', 'liumin', '果园街道', 'R3', '本街道 + 本类别全区', '今天 08:44', '正常'],
    ['周立新', 'zhoulx', '十里堡镇', 'R3', '本镇街 + 本类别全区', '11-09 15:07', '正常'],
    ['吴春梅', 'wucm', '区信访办', 'R3', '信访来源 + 本类别全区', '11-07 10:33', '正常'],
    ['徐建华', 'xujh', '区公安分局', 'R3', '公安来源 + 本类别全区', '今天 06:50', '正常'],
    ['李强', 'liqiang', '区公安分局', 'R4', '公安来源人员', '今天 09:10', '正常'],
    ['马文斌', 'mawb', '区公安分局', 'R4', '公安来源人员', '今天 08:33', '正常'],
    ['胡志远', 'huzhiy', '区公安分局', 'R4', '公安来源人员', '昨天 16:02', '正常'],
    ['高鹏', 'gaopeng', '区卫健委', 'R4', '卫健来源人员', '今天 07:40', '正常'],
    ['林晓静', 'linxj', '区卫健委', 'R4', '卫健来源人员', '昨天 15:26', '正常'],
    ['何丽', 'heli', '区司法局', 'R4', '司法来源人员', '11-09 14:11', '正常'],
    ['宋建军', 'songjj', '区司法局', 'R4', '司法来源人员', '11-08 11:05', '正常'],
    ['罗永强', 'luoyq', '区信访办', 'R4', '信访来源人员', '今天 08:58', '正常'],
    ['蒋波', 'jiangbo', '区信访办', 'R4', '信访来源人员', '昨天 17:45', '正常'],
    ['崔雪', 'cuixue', '区委政法委', 'R4', '政法委来源人员', '今天 09:15', '正常'],
    ['范志刚', 'fanzg', '区公安分局', 'R4', '公安来源人员', '11-06 13:20', '正常'],
    ['王海峰', 'wanghf', '溪翁庄镇', 'R5', '本辖区（16 社区）', '今天 10:31', '正常'],
    ['张海涛', 'zhanght', '城关派出所', 'R5', '鼓楼街道', '今天 08:47', '正常'],
    ['赵鹤', 'zhaohe', '檀营地区', 'R5', '檀营地区', '08-02 11:20', '90 天未登录'],
    ['李春燕', 'licy', '鼓楼街道', 'R5', '鼓楼街道', '今天 07:58', '正常'],
    ['孙宝良', 'sunbl', '十里堡镇', 'R5', '十里堡镇', '昨天 16:35', '正常'],
    ['马秀英', 'maxy', '河南寨镇', 'R5', '河南寨镇', '今天 09:26', '正常'],
    ['李长海', 'lich', '果园街道', 'R5', '果园街道', '11-09 15:44', '正常'],
    ['周天宇', 'zhouty', '巨各庄镇', 'R5', '巨各庄镇', '11-08 10:12', '正常'],
    ['杨丽娟', 'yanglj', '不老屯镇', 'R5', '不老屯镇', '07-28 09:05', '90 天未登录'],
    ['郭海涛', 'guoht', '东邵渠镇', 'R5', '东邵渠镇', '今天 08:12', '正常'],
    ['王振国', 'wangzg', '鼓楼街道', 'R6', '鼓楼街道（16 社区）', '今天 07:42', '正常'],
    ['刘长江', 'liucj', '果园街道', 'R6', '果园街道', '今天 08:06', '正常'],
    ['周立新', 'zhoulx6', '十里堡镇', 'R6', '十里堡镇', '昨天 17:50', '正常'],
    ['陈志刚', 'chenzg', '檀营地区', 'R6', '檀营地区', '11-09 16:22', '正常'],
    ['马国庆', 'magq', '河南寨镇', 'R6', '河南寨镇', '今天 09:04', '正常'],
    ['刘建国', 'liujg', '区政务云运维', 'R7', '无业务数据权限', '今天 06:05', '正常'],
    ['郭立新', 'guolx', '区委政法委', 'R8', '无业务数据权限', '11-09 10:12', '正常'],
    ['杨帆', 'yangfan', '区委政法委', 'R9', '仅日志', '今天 09:02', '正常'],
    ['钱立军', 'qianlj', '区司法局', 'R5', '区司法局辖区', '06-15 14:30', '90 天未登录']
  ].map((a, i) => ({ id: 'ACC-' + String(i + 1).padStart(3, '0'), name: a[0], account: a[1], unit: a[2], role: a[3], scope: a[4], login: a[5], status: a[6] }));

  /* ---------- 6. 十三部字典（每部含列定义 + 行数据） ---------- */
  /* col 类型：code 编码 / main 名称 / text 文本 / pills 风险序 / num 数字 / date 日期 / tag 状态 */
  const SYS_DICTS = [
    { key: 'rcl', group: '人员与等级', name: '人员类别标签', sub: '对应 11 类重点人员口径', unit: '项',
      cols: [
        { k: 'code', t: '编码', w: 74, type: 'code' }, { k: 'name', t: '名称', w: 150, type: 'main' },
        { k: 'dept', t: '归属部门', w: 92, type: 'dept' }, { k: 'levels', t: '可对应等级', w: 96, type: 'pills' },
        { k: 'refs', t: '引用人次', w: 78, type: 'num' }, { k: 'changed', t: '最近变更', w: 96, type: 'date' },
        { k: 'on', t: '状态', w: 60, type: 'tag' }
      ],
      foot: '引用影响面：人员档案 6,028 · 报表 14 张 · 预警规则 7 条 · 导出模板 5 套',
      rows: [
        { code: 'RCL-01', name: '涉访关注人员', dept: '区信访办', levels: [1, 2, 3], refs: 1568, changed: '2026-10-12', on: true },
        { code: 'RCL-02', name: '六失一偏人员', dept: '区委政法委', levels: [2, 3], refs: 1462, changed: '2026-09-28', on: true },
        { code: 'RCL-03', name: '严重精神障碍患者', dept: '区卫健委', levels: [1, 2, 3], refs: 1204, changed: '2026-10-30', on: true },
        { code: 'RCL-04', name: '安置帮教人员', dept: '区司法局', levels: [3], refs: 712, changed: '2026-08-16', on: true },
        { code: 'RCL-05', name: '吸毒人员', dept: '公安分局', levels: [2, 3], refs: 638, changed: '2026-07-22', on: true },
        { code: 'RCL-06', name: '社区矫正对象', dept: '区司法局', levels: [2, 3], refs: 486, changed: '2026-09-05', on: true },
        { code: 'RCL-07', name: '邪教人员', dept: '公安分局', levels: [1, 2], refs: 342, changed: '2026-06-11', on: true },
        { code: 'RCL-08', name: '政保重点人', dept: '公安分局', levels: [1, 2], refs: 268, changed: '2026-05-19', on: true },
        { code: 'RCL-09', name: '不良行为未成年人', dept: '公安分局', levels: [3], refs: 186, changed: '2026-11-09', on: false, pending: true },
        { code: 'RCL-10', name: '反恐关注群体', dept: '公安分局', levels: [1], refs: 152, changed: '2026-04-08', on: true },
        { code: 'RCL-11', name: '扬言类重点人', dept: '公安分局', levels: [1], refs: 94, changed: '2026-10-12', on: true }
      ] },
    { key: 'level', group: '人员与等级', name: '管控等级', sub: '统一风险序 1—4 档', unit: '档',
      cols: [
        { k: 'code', t: '风险序', w: 74, type: 'code' }, { k: 'name', t: '等级名称', w: 130, type: 'main' },
        { k: 'desc', t: '判定口径', w: 260, type: 'text' }, { k: 'visit', t: '走访时限', w: 86, type: 'text' },
        { k: 'refs', t: '在册人数', w: 86, type: 'num' }, { k: 'on', t: '状态', w: 60, type: 'tag' }
      ],
      foot: '风险序是全区唯一等级口径，部门原等级须先映射到本表再参与统计',
      rows: [
        { code: '1', name: '一级（高）', desc: '可能引发重大案事件，须区级直接掌握、每周见面', visit: '7 日', refs: 486, on: true },
        { code: '2', name: '二级（中）', desc: '有一定风险，部门与属地双线管控', visit: '30 日', refs: 1642, on: true },
        { code: '3', name: '三级（低）', desc: '风险较低，常规随访', visit: '90 日', refs: 3186, on: true },
        { code: '4', name: '四级（待核实）', desc: '依据缺失或拒不配合，须补评后定级', visit: '15 日', refs: 714, on: true }
      ] },
    { key: 'deptlevel', group: '人员与等级', name: '部门原等级口径', sub: '四部门等级 → 风险序映射', unit: '项',
      cols: [
        { k: 'code', t: '编码', w: 82, type: 'code' }, { k: 'dept', t: '部门', w: 92, type: 'dept' },
        { k: 'raw', t: '原等级名称', w: 180, type: 'main' }, { k: 'map', t: '映射风险序', w: 92, type: 'pills' },
        { k: 'on', t: '状态', w: 60, type: 'tag' }
      ],
      foot: '就高不就低：一人多标时取各区级映射结果中的最高档，不重复计数',
      rows: [
        { code: 'DL-01', dept: '公安分局', raw: '一级（政保 / 涉访内控）', map: [1], on: true },
        { code: 'DL-02', dept: '公安分局', raw: '二级', map: [2], on: true },
        { code: 'DL-03', dept: '公安分局', raw: '三级', map: [3], on: true },
        { code: 'DL-04', dept: '公安分局', raw: '扬言类', map: [1], on: true },
        { code: 'DL-05', dept: '区卫健委', raw: '危险性评估 5 级', map: [1], on: true },
        { code: 'DL-06', dept: '区卫健委', raw: '危险性评估 4 级', map: [1], on: true },
        { code: 'DL-07', dept: '区卫健委', raw: '危险性评估 3 级', map: [1], on: true },
        { code: 'DL-08', dept: '区卫健委', raw: '危险性评估 2 级', map: [2], on: true },
        { code: 'DL-09', dept: '区卫健委', raw: '危险性评估 1 级', map: [3], on: true },
        { code: 'DL-10', dept: '区卫健委', raw: '拒访记「不详」', map: [4], on: true },
        { code: 'DL-11', dept: '区信访办', raw: '涉访 A 类', map: [1], on: true },
        { code: 'DL-12', dept: '区信访办', raw: '涉访 B 类', map: [2], on: true },
        { code: 'DL-13', dept: '区信访办', raw: '涉访 C 类', map: [3], on: true },
        { code: 'DL-14', dept: '区司法局', raw: '社区矫正 严管', map: [2], on: true },
        { code: 'DL-15', dept: '区司法局', raw: '社区矫正 普管', map: [3], on: true },
        { code: 'DL-16', dept: '区司法局', raw: '社区矫正 宽管', map: [3], on: true },
        { code: 'DL-17', dept: '区委政法委', raw: '六失一偏 重点 / 一般', map: [2, 3], on: true }
      ] },
    { key: 'xf', group: '人员与等级', name: '涉访类别', sub: 'A 类 / B 类 / C 类', unit: '类',
      cols: [
        { k: 'code', t: '编码', w: 74, type: 'code' }, { k: 'name', t: '类别', w: 120, type: 'main' },
        { k: 'desc', t: '判定要点', w: 280, type: 'text' }, { k: 'refs', t: '在册人数', w: 86, type: 'num' },
        { k: 'on', t: '状态', w: 60, type: 'tag' }
      ],
      rows: [
        { code: 'XF-A', name: 'A 类（重点）', desc: '有进京访、集体访记录或明确扬言', refs: 268, on: true },
        { code: 'XF-B', name: 'B 类（关注）', desc: '有信访诉求且情绪对立，未发生越级访', refs: 642, on: true },
        { code: 'XF-C', name: 'C 类（一般）', desc: '历史信访已化解，保持常态关注', refs: 1180, on: true }
      ] },
    { key: 'danger', group: '人员与等级', name: '危险性评估等级', sub: '卫健 1—5 级 + 不详', unit: '级',
      cols: [
        { k: 'code', t: '等级', w: 74, type: 'code' }, { k: 'name', t: '名称', w: 120, type: 'main' },
        { k: 'desc', t: '评估口径', w: 300, type: 'text' }, { k: 'refs', t: '在册人数', w: 86, type: 'num' },
        { k: 'on', t: '状态', w: 60, type: 'tag' }
      ],
      rows: [
        { code: 'W-5', name: '5 级', desc: '有暴力行为史且近期症状活跃', refs: 86, on: true },
        { code: 'W-4', name: '4 级', desc: '症状明显，自知力部分缺失', refs: 142, on: true },
        { code: 'W-3', name: '3 级', desc: '症状持续，需规律服药与随访', refs: 276, on: true },
        { code: 'W-2', name: '2 级', desc: '症状偶发，家属监护到位', refs: 418, on: true },
        { code: 'W-1', name: '1 级', desc: '病情稳定，年度复评', refs: 282, on: true },
        { code: 'W-U', name: '不详', desc: '拒访或未取得评估结论，按待核实管控', refs: 74, on: true }
      ] },
    { key: 'reason', group: '业务过程', name: '列入原因', sub: '台账列入事由', unit: '项',
      cols: [
        { k: 'code', t: '编码', w: 86, type: 'code' }, { k: 'name', t: '列入原因', w: 180, type: 'main' },
        { k: 'dept', t: '主责部门', w: 100, type: 'dept' }, { k: 'refs', t: '引用人次', w: 86, type: 'num' },
        { k: 'on', t: '状态', w: 60, type: 'tag' }
      ],
      rows: [
        { code: 'RS-01', name: '有进京访记录', dept: '区信访办', refs: 486, on: true },
        { code: 'RS-02', name: '扬言类言行', dept: '公安分局', refs: 94, on: true },
        { code: 'RS-03', name: '严重精神障碍确诊', dept: '区卫健委', refs: 1204, on: true },
        { code: 'RS-04', name: '社区矫正期内', dept: '区司法局', refs: 486, on: true },
        { code: 'RS-05', name: '安置帮教期内', dept: '区司法局', refs: 712, on: true },
        { code: 'RS-06', name: '吸毒成瘾未戒断', dept: '公安分局', refs: 638, on: true },
        { code: 'RS-07', name: '政保列管', dept: '公安分局', refs: 268, on: true },
        { code: 'RS-08', name: '六失一偏', dept: '区委政法委', refs: 1462, on: true },
        { code: 'RS-09', name: '不良行为未成年人', dept: '公安分局', refs: 186, on: true },
        { code: 'RS-10', name: '反恐关注群体', dept: '公安分局', refs: 152, on: true },
        { code: 'RS-11', name: '重大矛盾纠纷未化解', dept: '区信访办', refs: 342, on: true },
        { code: 'RS-12', name: '家庭重大变故后情绪失控', dept: '属地镇街', refs: 128, on: true },
        { code: 'RS-13', name: '涉众型案件受损人', dept: '公安分局', refs: 216, on: true },
        { code: 'RS-14', name: '长期拒不配合核查', dept: '属地镇街', refs: 92, on: true },
        { code: 'RS-15', name: '监护人缺失', dept: '区卫健委', refs: 64, on: true },
        { code: 'RS-16', name: '跨区流入未落地', dept: '属地镇街', refs: 38, on: false },
        { code: 'RS-17', name: '重复反映同一事项', dept: '区信访办', refs: 184, on: true },
        { code: 'RS-18', name: '其他（需说明）', dept: '区委政法委', refs: 26, on: true }
      ] },
    { key: 'disposal', group: '业务过程', name: '处置方式', sub: '预警处置与结案方式', unit: '项',
      cols: [
        { k: 'code', t: '编码', w: 86, type: 'code' }, { k: 'name', t: '处置方式', w: 160, type: 'main' },
        { k: 'desc', t: '适用场景', w: 260, type: 'text' }, { k: 'refs', t: '引用次数', w: 86, type: 'num' },
        { k: 'on', t: '状态', w: 60, type: 'tag' }
      ],
      rows: [
        { code: 'DP-01', name: '入户见面', desc: '可接触、风险可控，完成见面即闭环', refs: 1864, on: true },
        { code: 'DP-02', name: '电话联系', desc: '仅作辅助，不计入有效走访', refs: 928, on: true },
        { code: 'DP-03', name: '联合研判', desc: '多部门会商后确定管控措施', refs: 276, on: true },
        { code: 'DP-04', name: '转派属地', desc: '人户分离或跨镇街流动', refs: 182, on: true },
        { code: 'DP-05', name: '推送精防医生', desc: '卫健口径高风险，需专业随访', refs: 148, on: true },
        { code: 'DP-06', name: '转督办', desc: '超期未闭环转重点时期督办', refs: 64, on: true }
      ] },
    { key: 'visitway', group: '业务过程', name: '走访方式', sub: '见面 / 电话 / 视频等', unit: '项',
      cols: [
        { k: 'code', t: '编码', w: 86, type: 'code' }, { k: 'name', t: '方式', w: 140, type: 'main' },
        { k: 'desc', t: '是否计入有效走访', w: 260, type: 'text' }, { k: 'refs', t: '使用次数', w: 86, type: 'num' },
        { k: 'on', t: '状态', w: 60, type: 'tag' }
      ],
      rows: [
        { code: 'VW-01', name: '入户见面', desc: '计入有效走访，须有见面照片与签字', refs: 3268, on: true },
        { code: 'VW-02', name: '电话联系', desc: '不计入有效走访，可作辅助记录', refs: 1826, on: true },
        { code: 'VW-03', name: '视频通话', desc: '计为一次有效联系，间隔按电话计', refs: 412, on: true },
        { code: 'VW-04', name: '邻里侧面了解', desc: '不计入有效走访，作补充依据', refs: 268, on: true },
        { code: 'VW-05', name: '联合面访', desc: '计入有效走访，多部门共同签字', refs: 186, on: true }
      ] },
    { key: 'chgtype', group: '业务过程', name: '等级变更类型', sub: '上调 / 下调 / 新增 / 消减等', unit: '项',
      cols: [
        { k: 'code', t: '编码', w: 86, type: 'code' }, { k: 'name', t: '变更类型', w: 150, type: 'main' },
        { k: 'desc', t: '审批要求', w: 280, type: 'text' }, { k: 'refs', t: '本月发生', w: 86, type: 'num' },
        { k: 'on', t: '状态', w: 60, type: 'tag' }
      ],
      rows: [
        { code: 'CT-01', name: '上调（跨档）', desc: '须逐级审批，跨档必到区级', refs: 19, on: true },
        { code: 'CT-02', name: '下调', desc: '不跨级下调，部门内闭环', refs: 27, on: true },
        { code: 'CT-03', name: '新增入册', desc: '建档即定级，缺依据记待核实', refs: 46, on: true },
        { code: 'CT-04', name: '减册销号', desc: '须双人复核并留存依据', refs: 12, on: true },
        { code: 'CT-05', name: '并档合并', desc: '双在册 → 一人一档，就高不就低', refs: 8, on: true },
        { code: 'CT-06', name: '补评定级', desc: '未定级人员完成评估后定级', refs: 6, on: true }
      ] },
    { key: 'town', group: '组织与区划', name: '行政区划 · 镇街', sub: '17 镇 + 3 街道', unit: '个',
      cols: [
        { k: 'code', t: '区划编码', w: 110, type: 'code' }, { k: 'name', t: '镇街', w: 130, type: 'main' },
        { k: 'type', t: '类型', w: 80, type: 'text' }, { k: 'comm', t: '社区村数', w: 90, type: 'num' },
        { k: 'refs', t: '在册人数', w: 86, type: 'num' }, { k: 'on', t: '状态', w: 60, type: 'tag' }
      ],
      rows: [
        { code: '110228001', name: '鼓楼街道', type: '街道', comm: 16, refs: 486, on: true },
        { code: '110228002', name: '果园街道', type: '街道', comm: 12, refs: 412, on: true },
        { code: '110228003', name: '檀营地区', type: '街道', comm: 8, refs: 268, on: true },
        { code: '110228100', name: '密云镇', type: '镇', comm: 14, refs: 226, on: true },
        { code: '110228101', name: '溪翁庄镇', type: '镇', comm: 16, refs: 318, on: true },
        { code: '110228102', name: '十里堡镇', type: '镇', comm: 12, refs: 286, on: true },
        { code: '110228103', name: '河南寨镇', type: '镇', comm: 18, refs: 342, on: true },
        { code: '110228104', name: '巨各庄镇', type: '镇', comm: 21, refs: 386, on: true },
        { code: '110228105', name: '穆家峪镇', type: '镇', comm: 19, refs: 296, on: true },
        { code: '110228106', name: '太师屯镇', type: '镇', comm: 22, refs: 424, on: true },
        { code: '110228107', name: '高岭镇', type: '镇', comm: 15, refs: 268, on: true },
        { code: '110228108', name: '不老屯镇', type: '镇', comm: 18, refs: 312, on: true },
        { code: '110228109', name: '冯家峪镇', type: '镇', comm: 12, refs: 186, on: true },
        { code: '110228110', name: '石城镇', type: '镇', comm: 10, refs: 142, on: true },
        { code: '110228111', name: '西田各庄镇', type: '镇', comm: 20, refs: 364, on: true },
        { code: '110228112', name: '北庄镇', type: '镇', comm: 11, refs: 158, on: true },
        { code: '110228113', name: '新城子镇', type: '镇', comm: 9, refs: 124, on: true },
        { code: '110228114', name: '古北口镇', type: '镇', comm: 13, refs: 196, on: true },
        { code: '110228115', name: '大城子镇', type: '镇', comm: 16, refs: 232, on: true },
        { code: '110228116', name: '东邵渠镇', type: '镇', comm: 12, refs: 204, on: true }
      ] },
    { key: 'community', group: '组织与区划', name: '行政区划 · 社区村', sub: '三级归属，支持地图下钻', unit: '个',
      cols: [
        { k: 'code', t: '区划编码', w: 116, type: 'code' }, { k: 'name', t: '社区 / 村', w: 140, type: 'main' },
        { k: 'town', t: '所属镇街', w: 110, type: 'text' }, { k: 'type', t: '类型', w: 76, type: 'text' },
        { k: 'refs', t: '在册人数', w: 86, type: 'num' }, { k: 'on', t: '状态', w: 60, type: 'tag' }
      ],
      foot: '全区共 372 个社区村，此处列出鼓楼街道等 12 个作为演示；完整区划由「导入区划」维护',
      rows: [
        { code: '110228001001', name: '长安西社区', town: '鼓楼街道', type: '社区', refs: 42, on: true },
        { code: '110228001002', name: '长安东社区', town: '鼓楼街道', type: '社区', refs: 38, on: true },
        { code: '110228001003', name: '车站路社区', town: '鼓楼街道', type: '社区', refs: 46, on: true },
        { code: '110228001004', name: '宾阳里社区', town: '鼓楼街道', type: '社区', refs: 34, on: true },
        { code: '110228001005', name: '花园东社区', town: '鼓楼街道', type: '社区', refs: 28, on: true },
        { code: '110228001006', name: '南菜园社区', town: '鼓楼街道', type: '社区', refs: 31, on: true },
        { code: '110228001007', name: '白檀社区', town: '鼓楼街道', type: '社区', refs: 26, on: true },
        { code: '110228001008', name: '东菜园社区', town: '鼓楼街道', type: '社区', refs: 22, on: true },
        { code: '110228001009', name: '沿湖社区', town: '鼓楼街道', type: '社区', refs: 19, on: true },
        { code: '110228001010', name: '行宫社区', town: '鼓楼街道', type: '社区', refs: 24, on: true },
        { code: '110228001011', name: '檀营社区', town: '檀营地区', type: '社区', refs: 18, on: true },
        { code: '110228001012', name: '鼓楼南社区', town: '鼓楼街道', type: '社区', refs: 21, on: true }
      ] },
    { key: 'dept', group: '组织与区划', name: '责任部门', sub: '4 区级 + 3 成员单位 + 2 支撑', unit: '个',
      cols: [
        { k: 'code', t: '编码', w: 92, type: 'code' }, { k: 'name', t: '部门', w: 140, type: 'main' },
        { k: 'type', t: '类型', w: 96, type: 'text' }, { k: 'head', t: '主管', w: 90, type: 'text' },
        { k: 'refs', t: '在册人数', w: 86, type: 'num' }, { k: 'on', t: '状态', w: 60, type: 'tag' }
      ],
      rows: [
        { code: 'DPT-01', name: '区委政法委', type: '区级', head: '陈志远', refs: 1462, on: true },
        { code: 'DPT-02', name: '区公安分局', type: '区级', head: '王立', refs: 1868, on: true },
        { code: 'DPT-03', name: '区卫健委', type: '区级', head: '孙敏', refs: 1204, on: true },
        { code: 'DPT-04', name: '区信访办', type: '区级', head: '周敏', refs: 1568, on: true },
        { code: 'DPT-05', name: '区司法局', type: '成员单位', head: '李明', refs: 1198, on: true },
        { code: 'DPT-06', name: '区委宣传部', type: '成员单位', head: '郑海燕', refs: 0, on: true },
        { code: 'DPT-07', name: '区民政局', type: '成员单位', head: '吴春梅', refs: 386, on: true },
        { code: 'DPT-08', name: '区政务云运维', type: '支撑', head: '刘建国', refs: 0, on: true },
        { code: 'DPT-09', name: '属地镇街（20）', type: '支撑', head: '各属地负责人', refs: 6028, on: true }
      ] },
    { key: 'notice', group: '组织与区划', name: '通知模板', sub: '预警 / 督办 / 零报告提醒', unit: '套',
      cols: [
        { k: 'code', t: '编码', w: 92, type: 'code' }, { k: 'name', t: '模板名称', w: 150, type: 'main' },
        { k: 'channel', t: '发送渠道', w: 120, type: 'text' }, { k: 'desc', t: '触发场景', w: 240, type: 'text' },
        { k: 'on', t: '状态', w: 60, type: 'tag' }
      ],
      rows: [
        { code: 'NT-01', name: '预警待办提醒', channel: '政务通 + 短信', desc: '规则命中生成待办时推送给责任人', on: true },
        { code: 'NT-02', name: '超期未处置督办', channel: '政务通', desc: '闭环时限前 1 日与超期当日各推一次', on: true },
        { code: 'NT-03', name: '零报告提醒', channel: '短信', desc: '重点时期每日 19:00 提醒未报镇街', on: true },
        { code: 'NT-04', name: '等级调整审批通知', channel: '政务通', desc: '审批单流转到下一节点时推送', on: true },
        { code: 'NT-05', name: '越权访问告警', channel: '政务通 + 邮件', desc: '拦截后即时推安全管理员与审计员', on: true },
        { code: 'NT-06', name: '权限变更告知', channel: '政务通', desc: '角色或数据范围变更后告知本人与主管', on: true },
        { code: 'NT-07', name: '月度报送催办', channel: '政务通', desc: '每月 3 日前未报部门收到催办', on: false }
      ] }
  ];
  const SYS_DICT_OF = {};
  SYS_DICTS.forEach(d => { SYS_DICT_OF[d.key] = d; });

  /* ---------- 7. 时限与阈值（与预警规则条件双向绑定） ---------- */
  const SYS_PARAMS = [
    { key: 'visitGap', label: '日常走访时限', unit: '日', value: 30, rule: 'RG-01', tip: '超出即触发 RG-01 走访超期' },
    { key: 'visitWartime', label: '重点时期走访时限', unit: '日', value: 7, rule: 'RG-12', tip: '一级响应期间按日见面', pending: 5 },
    { key: 'dualConfirm', label: '双在册确认时限', unit: '日', value: 3, rule: 'RG-03', tip: '两部门确认闭环须在此期限内完成', pending: 5 },
    { key: 'alertClose', label: '预警处置闭环时限', unit: '日', value: 7, rule: '', tip: '超期转重点时期督办' },
    { key: 'assessValid', label: '评估材料有效期', unit: '个月', value: 12, rule: 'RG-06', tip: '超期触发 RG-06 依据缺失' },
    { key: 'recheckCycle', label: '风险等级复评周期', unit: '日', value: 180, rule: '', tip: '低风险可延长至 365 日' },
    { key: 'zeroDue', label: '零报告提交截止', unit: '', value: '20:00', rule: 'RG-12', tip: '重点时期每日截止时间' }
  ];

  /* ---------- 8. 等级变动定级流程（会议决议 D4：政法委无审批职能） ----------
     做法：等级由部门自主定级，政法委侧只做统筹备案与知会，不设审批关口。
     节点名与 risk.html「部门内部定级流程」四档一致；`days` 为定级时限（原审批时限）。
     末节点「报政法委备案」是知会留痕，不是审批节点——演示时要讲清这个区别。 */
  const SYS_ROUTES = [
    { to: 1, name: '调为 1 高风险', days: 3, nodes: ['部门经办提交', '部门主管核定', '分管领导会商', '部门集体会签', '报政法委备案'] },
    { to: 2, name: '调为 2 中风险', days: 5, nodes: ['部门经办提交', '部门主管核定', '分管领导会商', '报政法委备案'] },
    { to: 3, name: '调为 3 低风险', days: 7, nodes: ['部门经办提交', '部门主管核定', '报政法委备案'] },
    { to: 4, name: '调为 4 待核实', days: 7, nodes: ['部门经办提交', '属地负责人核定', '报政法委备案'] }
  ];

  /* ---------- 9. 近 7 日命中趋势（按日 + 按规则，供悬浮与下钻共用） ----------
     每日合计与规则表「今日命中」逐项对账：11-10 = 64+18+9+23+12+31+6+3+5+2 = 173 */
  const SYS_TREND = [
    { date: '11-04', total: 128, rules: { 'RG-01': 48, 'RG-02': 12, 'RG-03': 7, 'RG-04': 17, 'RG-05': 9, 'RG-06': 23, 'RG-07': 5, 'RG-10': 4, 'RG-11': 3, 'RG-12': 0 } },
    { date: '11-05', total: 141, rules: { 'RG-01': 52, 'RG-02': 14, 'RG-03': 8, 'RG-04': 19, 'RG-05': 10, 'RG-06': 25, 'RG-07': 5, 'RG-10': 4, 'RG-11': 3, 'RG-12': 1 } },
    { date: '11-06', total: 152, rules: { 'RG-01': 58, 'RG-02': 15, 'RG-03': 8, 'RG-04': 20, 'RG-05': 11, 'RG-06': 27, 'RG-07': 5, 'RG-10': 4, 'RG-11': 3, 'RG-12': 1 } },
    { date: '11-07', total: 160, rules: { 'RG-01': 62, 'RG-02': 16, 'RG-03': 9, 'RG-04': 21, 'RG-05': 11, 'RG-06': 28, 'RG-07': 5, 'RG-10': 4, 'RG-11': 3, 'RG-12': 1 } },
    { date: '11-08', total: 138, rules: { 'RG-01': 50, 'RG-02': 13, 'RG-03': 7, 'RG-04': 18, 'RG-05': 10, 'RG-06': 26, 'RG-07': 5, 'RG-10': 4, 'RG-11': 3, 'RG-12': 2 } },
    { date: '11-09', total: 152, rules: { 'RG-01': 56, 'RG-02': 15, 'RG-03': 8, 'RG-04': 20, 'RG-05': 11, 'RG-06': 28, 'RG-07': 5, 'RG-10': 4, 'RG-11': 3, 'RG-12': 2 } },
    { date: '11-10', total: 173, rules: { 'RG-01': 64, 'RG-02': 18, 'RG-03': 9, 'RG-04': 23, 'RG-05': 12, 'RG-06': 31, 'RG-07': 6, 'RG-10': 3, 'RG-11': 5, 'RG-12': 2 } }
  ];

  /* ---------- 10. 安全事件链路（越权 / 明文访问 · 6 条，供多条呈现与时间线） ----------
     每条含：账号、角色、事件类型、次数、状态、处置人、链路节点。
     链路节点同步落到审计流水（SYS_EVENT_LOG），保证「事件卡 ↔ 日志明细」可对账。 */
  const SYS_EVENTS = [
    { id: 'SE-01', name: '李强', account: 'liqiang', role: 'R4', unit: '区公安分局', kind: '越权访问', level: 'high', count: 3, status: '已提醒', latest: '11-10 08:58', owner: '郭立新',
      chain: [
        { at: '11-10 08:12', act: '越权尝试', text: '访问非本部门标签内容 · 仅返回数量', result: '受限' },
        { at: '11-10 08:41', act: '越权尝试', text: '导出 >50 条明文未申请', result: '拒绝' },
        { at: '11-10 08:58', act: '越权尝试', text: '请求卫健来源人员档案 · 无数据范围权限', result: '拒绝' },
        { at: '11-10 09:00', act: '规则命中', text: 'RG-10 越权访问尝试 · 累计 3 次（阈值 5 次）', result: '待观察' },
        { at: '11-10 09:01', act: '推送告警', text: '推送安全管理员 郭立新 · 政务通 + 邮件', result: '成功' },
        { at: '11-10 09:20', act: '人工复核', text: '安全管理员核对为业务不熟，已当面告知并记录', result: '已闭环' }
      ] },
    { id: 'SE-02', name: '杨丽娟', account: 'yanglj', role: 'R5', unit: '不老屯镇', kind: '账号长期未用', level: 'mid', count: 1, status: '已冻结', latest: '11-10 06:00', owner: '刘建国',
      chain: [
        { at: '11-10 06:00', act: '规则命中', text: 'RG-13 账号 90 天未登录 · 107 天', result: '待处置' },
        { at: '11-10 06:01', act: '自动冻结', text: '杨丽娟账号自动停用，名下待办 4 条转交属地负责人', result: '成功' },
        { at: '11-10 06:02', act: '推送通知', text: '告知本人与鼓楼街道负责人', result: '成功' }
      ] },
    { id: 'SE-03', name: '赵鹤', account: 'zhaohe', role: 'R5', unit: '檀营地区', kind: '账号长期未用', level: 'mid', count: 1, status: '待复核', latest: '11-10 06:00', owner: '刘建国',
      chain: [
        { at: '11-10 06:00', act: '规则命中', text: 'RG-13 账号 90 天未登录 · 100 天', result: '待处置' },
        { at: '11-10 06:01', act: '自动冻结', text: '赵鹤账号自动停用，名下待办 2 条转交', result: '成功' }
      ] },
    { id: 'SE-04', name: '钱立军', account: 'qianlj', role: 'R5', unit: '区司法局', kind: '账号长期未用', level: 'low', count: 1, status: '已冻结', latest: '11-09 06:00', owner: '刘建国',
      chain: [
        { at: '11-09 06:00', act: '规则命中', text: 'RG-13 账号 90 天未登录 · 150 天', result: '待处置' },
        { at: '11-09 06:01', act: '自动冻结', text: '钱立军账号自动停用', result: '成功' }
      ] },
    { id: 'SE-05', name: '张海涛', account: 'zhanght', role: 'R5', unit: '城关派出所', kind: '明文访问', level: 'mid', count: 2, status: '已闭环', latest: '11-10 07:18', owner: '郭立新',
      chain: [
        { at: '11-10 07:18', act: '明文查看', text: '任玉荣 身份证号 · 审批单 MY-AP-2026-0871 · 有效期 24 小时', result: '已授权' },
        { at: '11-10 07:26', act: '明文查看', text: '同一人 联系电话 · 复用审批单', result: '已授权' },
        { at: '11-10 08:00', act: '到期回收', text: '授权到期自动回收，未发生二次访问', result: '成功' }
      ] },
    { id: 'SE-06', name: '王海峰', account: 'wanghf', role: 'R5', unit: '溪翁庄镇', kind: '越权访问', level: 'high', count: 3, status: '待复核', latest: '11-10 10:35', owner: '郭立新',
      chain: [
        { at: '11-10 10:12', act: '越权尝试', text: '查询巨各庄镇人员 · 非本辖区', result: '拒绝' },
        { at: '11-10 10:22', act: '越权尝试', text: '尝试导出跨辖区名册', result: '拒绝' },
        { at: '11-10 10:35', act: '越权尝试', text: '访问非本辖区档案（溪翁庄镇 3 份）· 策略拦截并告警', result: '拦截' },
        { at: '11-10 10:36', act: '规则命中', text: 'RG-10 越权访问尝试 · 累计 3 次（阈值 5 次）', result: '待观察' },
        { at: '11-10 10:37', act: '推送告警', text: '推送安全管理员 郭立新 · 政务网短信', result: '成功' }
      ] }
  ];

  /* 统计文本格式化 */
  function fmt(n) { return Number(n || 0).toLocaleString('en-US'); }

  return {
    towns, townOf, addPersons, recalcStats, fmt,
    persons, unrated, stats, levelOf, LEVELS, TAGS, IMPORT_FIELDS,
    deptsOf, deptStats,
    alerts, approvals, blind, imports, wartime, analytics, RULES,
    WT_REASONS, WT_REASON_OF, WT_WAYS, WT_TARGETS, WT_RESULTS, WT_LEVELS, WT_CFG, reportMonthly,
    WT_VISIT_STEPS, WT_REPORT_STEPS, WT_SCOPES, wtLevelText,
    wartimeRoster, wartimeRows,
    ROLES, field, scoped,
    personById, personByNo, visitsOf, historyOf, dutyOf,
    movesOf, hasSecondMove, moveRows,
    wartimeUnseen, wartimeUnseenAll, DQ_RULES, CHG_BASE, CHG_FULL, RESPONDERS, DEPT_HEAD, LEVEL_RULE_OF,
    RULE_OF,
    SYS_ROLES, SYS_ROLE_OF, SYS_PERMS, SYS_PERM_GROUPS, SYS_PERM_ALL, SYS_PERM_NAME,
    SYS_ROLE_PERMS, SYS_FIELDS, SYS_MASK, MASK_MODES, SYS_ACCOUNTS,
    SYS_DICTS, SYS_DICT_OF, SYS_PARAMS, SYS_ROUTES, SYS_TREND, SYS_EVENTS,
    maskId, maskName, maskPhone, dateBefore, dateRel, mulberry32,
    meta: {
      district: '北京市密云区',
      asOf: '2026-11-10 09:45',
      districtDays: '2026-11-10'
    }
  };
})();
