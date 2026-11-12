/* ============================================================
   fileparse.js · 真实文件解析（导入面板用，不是「假装导入」）
   ------------------------------------------------------------
   支持：
     .csv / .txt  —— UTF-8（含 BOM）/ GBK 自动识别，逗号或制表符分隔
     .xlsx        —— 原生解析 ZIP（DecompressionStream）+ sharedStrings + sheet1
     .json        —— [{...}, {...}] 数组
   不支持：.xls（二进制 BIFF）、.doc、图片等，会给出明确提示。
   同时提供：身份证校验位算法、库内查重、列名智能映射、示例文件生成。
   ============================================================ */
window.FILEPARSE = (function () {
  'use strict';

  /* ---------- 通用 ---------- */
  function ext(name) {
    const m = /\.([a-z0-9]+)$/i.exec(name || '');
    return m ? m[1].toLowerCase() : '';
  }
  function sizeText(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  }

  /* ---------- 编码识别 ---------- */
  function decodeText(buf) {
    const u8 = new Uint8Array(buf);
    if (u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) {
      return { text: new TextDecoder('utf-8').decode(u8.subarray(3)), encoding: 'UTF-8 BOM' };
    }
    // 先按 UTF-8 严格解码，失败再退 GBK（政务台账常见）
    try {
      return { text: new TextDecoder('utf-8', { fatal: true }).decode(u8), encoding: 'UTF-8' };
    } catch (e) {
      try {
        return { text: new TextDecoder('gbk').decode(u8), encoding: 'GBK' };
      } catch (e2) {
        return { text: new TextDecoder('utf-8').decode(u8), encoding: 'UTF-8（容错）' };
      }
    }
  }

  /* ---------- CSV ---------- */
  function parseCSV(text) {
    const firstLine = text.slice(0, text.indexOf('\n') >= 0 ? text.indexOf('\n') : text.length);
    const delim = firstLine.indexOf('\t') >= 0 && firstLine.split('\t').length > firstLine.split(',').length ? '\t' : ',';
    const rows = [];
    let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cur += '"'; i++; } else q = false;
        } else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) { row.push(cur); cur = ''; }
      else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (ch === '\r') { /* skip */ }
      else cur += ch;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(r => r.some(c => String(c).trim() !== ''));
  }

  /* ---------- ZIP / XLSX ---------- */
  async function inflateRaw(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function readZip(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 66000); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('不是有效的 xlsx（未找到 ZIP 结构）');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const entries = {};
    for (let i = 0; i < count; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const compSize = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const cmtLen = dv.getUint16(p + 32, true);
      const localOff = dv.getUint32(p + 42, true);
      const name = new TextDecoder('utf-8').decode(bytes.subarray(p + 46, p + 46 + nameLen));
      const lNameLen = dv.getUint16(localOff + 26, true);
      const lExtraLen = dv.getUint16(localOff + 28, true);
      const dataOff = localOff + 30 + lNameLen + lExtraLen;
      entries[name] = { method, compSize, dataOff };
      p += 46 + nameLen + extraLen + cmtLen;
    }
    return entries;
  }

  async function zipRead(bytes, entries, name) {
    const e = entries[name];
    if (!e) return null;
    const raw = bytes.subarray(e.dataOff, e.dataOff + e.compSize);
    if (e.method === 0) return raw;
    if (e.method === 8) return await inflateRaw(raw);
    throw new Error('xlsx 使用了不支持的压缩方式（method=' + e.method + '）');
  }

  function colIndex(ref) {
    const m = /^([A-Z]+)/.exec(ref || '');
    if (!m) return -1;
    let n = 0;
    for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }

  async function parseXLSX(buf) {
    const bytes = new Uint8Array(buf);
    const entries = readZip(bytes);
    const xml = async n => {
      const b = await zipRead(bytes, entries, n);
      if (!b) return null;
      return new TextDecoder('utf-8').decode(b);
    };
    const parser = new DOMParser();

    /* 共享字符串 */
    const shared = [];
    const ssXml = await xml('xl/sharedStrings.xml');
    if (ssXml) {
      const doc = parser.parseFromString(ssXml, 'application/xml');
      doc.querySelectorAll('si').forEach(si => {
        shared.push(Array.from(si.querySelectorAll('t')).map(t => t.textContent).join(''));
      });
    }

    /* 找第一张工作表：优先 sheet1.xml */
    let sheetName = 'xl/worksheets/sheet1.xml';
    if (!entries[sheetName]) {
      sheetName = Object.keys(entries).filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()[0];
    }
    if (!sheetName) throw new Error('xlsx 中未找到工作表');
    const shXml = await xml(sheetName);
    const doc = parser.parseFromString(shXml, 'application/xml');

    const rows = [];
    doc.querySelectorAll('sheetData > row').forEach(row => {
      const arr = [];
      row.querySelectorAll('c').forEach(c => {
        const idx = colIndex(c.getAttribute('r'));
        const t = c.getAttribute('t');
        let v = '';
        if (t === 's') {
          const si = c.querySelector('v');
          v = si ? (shared[Number(si.textContent)] || '') : '';
        } else if (t === 'inlineStr') {
          v = Array.from(c.querySelectorAll('is t')).map(x => x.textContent).join('');
        } else if (t === 'str') {
          const n = c.querySelector('v');
          v = n ? n.textContent : '';
        } else {
          const n = c.querySelector('v');
          v = n ? n.textContent : '';
        }
        if (idx >= 0) arr[idx] = v;
      });
      if (arr.some(x => x != null && String(x).trim() !== '')) rows.push(arr);
    });
    return rows.map(r => Array.from(r, x => (x == null ? '' : x)));
  }

  /* ---------- 主入口 ---------- */
  async function read(file) {
    const e = ext(file.name);
    const buf = await file.arrayBuffer();
    const base = { name: file.name, size: file.size, sizeText: sizeText(file.size), kind: e, warnings: [] };
    if (e === 'csv' || e === 'txt') {
      const d = decodeText(buf);
      const rows = parseCSV(d.text);
      base.encoding = d.encoding;
      base.sheet = '文本';
      return finish(base, rows);
    }
    if (e === 'xlsx') {
      const rows = await parseXLSX(buf);
      base.encoding = 'UTF-8 (OOXML)';
      base.sheet = 'Sheet1';
      return finish(base, rows);
    }
    if (e === 'json') {
      const d = decodeText(buf);
      const arr = JSON.parse(d.text);
      if (!Array.isArray(arr)) throw new Error('JSON 需为对象数组');
      const headers = Array.from(new Set(arr.reduce((a, o) => a.concat(Object.keys(o)), [])));
      base.encoding = d.encoding;
      base.sheet = 'JSON';
      return finish(base, [headers].concat(arr.map(o => headers.map(h => o[h]))));
    }
    if (e === 'xls') throw new Error('不支持 .xls（旧版二进制格式），请用 Excel 另存为 .xlsx 后重试');
    throw new Error('不支持的文件类型 .' + e + '，请上传 .xlsx / .csv');
  }

  function finish(base, rows) {
    if (!rows.length) throw new Error('文件为空或未解析到任何行');
    const headers = rows[0].map(h => String(h == null ? '' : h).trim());
    const body = rows.slice(1).filter(r => r.some(c => String(c == null ? '' : c).trim() !== ''));
    base.headers = headers;
    base.rows = body;
    if (!body.length) throw new Error('文件只有表头，没有数据行');
    if (headers.filter(Boolean).length < 2) base.warnings.push('有效列数偏少，请确认第一行为表头');
    return base;
  }

  /* ---------- 身份证校验位 ---------- */
  const ID_W = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const ID_C = '10X98765432';
  function idValid(id) {
    const s = String(id || '').trim().toUpperCase();
    if (!/^\d{17}[\dX]$/.test(s)) return false;
    let sum = 0;
    for (let i = 0; i < 17; i++) sum += Number(s[i]) * ID_W[i];
    return ID_C[sum % 11] === s[17];
  }
  function idBirth(id) {
    const s = String(id || '');
    if (s.length !== 18) return '';
    return s.slice(6, 10) + '-' + s.slice(10, 12) + '-' + s.slice(12, 14);
  }

  /* ---------- 列名智能映射 ---------- */
  const FIELDS = [
    { key: 'name', label: '姓名', alias: ['姓名', '人员姓名', '当事人', '名字', 'name'] },
    { key: 'idNo', label: '身份证号', alias: ['身份证号', '身份证', '身份证号码', '证件号码', 'idcard', 'idno'] },
    { key: 'phone', label: '联系电话', alias: ['联系电话', '手机号', '手机', '电话', 'phone'] },
    { key: 'tags', label: '风险类别 / 标签', alias: ['标签', '类别', '风险类别', '人员类别', '类型', 'tag'] },
    { key: 'town', label: '属地镇街', alias: ['镇街', '属地', '所属镇街', '街道', '乡镇', 'town'] },
    { key: 'dept', label: '来源部门', alias: ['部门', '来源', '来源部门', '报送单位', 'dept'] },
    { key: 'level', label: '风险等级', alias: ['等级', '风险等级', '管控等级', 'level'] },
    { key: 'note', label: '备注', alias: ['备注', '说明', '情况说明', 'note'] }
  ];
  function guessMap(headers) {
    const out = {};
    FIELDS.forEach(f => {
      const idx = headers.findIndex(h => {
        const s = String(h || '').replace(/\s/g, '').toLowerCase();
        if (!s) return false;
        return f.alias.some(a => s === a.toLowerCase() || s.indexOf(a.toLowerCase()) >= 0);
      });
      out[f.key] = idx;
    });
    return out;
  }

  /* ---------- 校验 + 查重（真实计算，不是写死的数字） ---------- */
  function validate(rows, map, opt) {
    const o = opt || {};
    const dbIds = o.dbIds || new Set();
    const seen = new Set();
    const levelMap = { '极高风险': 'high2', '高风险': 'high', '中风险': 'mid', '低风险': 'low', '待核实': 'unknown' };
    const out = rows.map((r, i) => {
      const get = k => (map[k] >= 0 ? String(r[map[k]] == null ? '' : r[map[k]]).trim() : '');
      const rec = {
        line: i + 2,
        name: get('name'),
        idNo: get('idNo').toUpperCase(),
        phone: get('phone'),
        tags: get('tags') ? get('tags').split(/[\/、,，;；|]/).map(s => s.trim()).filter(Boolean) : [],
        town: get('town'),
        dept: get('dept'),
        level: levelMap[get('level')] || '',
        note: get('note'),
        status: 'ok',
        reason: ''
      };
      if (!rec.name) { rec.status = 'fail'; rec.reason = '姓名为空'; }
      else if (!rec.idNo) { rec.status = 'fail'; rec.reason = '身份证号为空'; }
      else if (!idValid(rec.idNo)) { rec.status = 'fail'; rec.reason = '身份证校验位不正确'; }
      else if (seen.has(rec.idNo)) { rec.status = 'dup'; rec.reason = '文件内重复'; }
      else if (dbIds.has(rec.idNo)) { rec.status = 'dup'; rec.reason = '库内已存在'; }
      else if (rec.town && o.towns && o.towns.length && o.towns.indexOf(rec.town) < 0) { rec.status = 'warn'; rec.reason = '镇街名称无法匹配，需人工归属'; }
      if (rec.status === 'ok' || rec.status === 'warn') seen.add(rec.idNo);
      return rec;
    });
    const stat = {
      total: out.length,
      ok: out.filter(x => x.status === 'ok').length,
      warn: out.filter(x => x.status === 'warn').length,
      dup: out.filter(x => x.status === 'dup').length,
      fail: out.filter(x => x.status === 'fail').length
    };
    stat.importable = stat.ok + stat.warn;
    return { rows: out, stat };
  }

  /* ---------- 示例文件（真实可下载、可回传解析） ---------- */
  function sampleCSV() {
    const TOWNS = ['鼓楼街道', '果园街道', '十里堡镇', '河南寨镇', '溪翁庄镇'];
    const TAG = ['涉访 A 类', '严重精神障碍', '社区矫正', '吸毒人员', '扬言类重点人'];
    const LV = ['高风险', '高风险', '中风险', '待核实'];
    const SN = '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜';
    const GN = ['志国', '秀英', '建华', '桂兰', '长山', '凤芝', '立军', '宝柱', '玉梅', '德顺', '全文', '秀云'];
    const ID_W2 = ID_W, ID_C2 = ID_C;
    const mkId = (y, m, d, seq) => {
      const body = '110228' + y + m + d + seq;
      let s = 0;
      for (let i = 0; i < 17; i++) s += Number(body[i]) * ID_W2[i];
      return body + ID_C2[s % 11];
    };
    const rows = [['姓名', '身份证号', '联系电话', '风险类别', '属地镇街', '来源部门', '风险等级', '备注']];
    for (let i = 0; i < 20; i++) {
      const y = 1955 + (i * 3) % 45, m = String(1 + (i * 5) % 12).padStart(2, '0'), d = String(1 + (i * 7) % 28).padStart(2, '0');
      const seq = String(100 + i * 7).padStart(3, '0');
      let id = mkId(String(y), m, d, seq);
      // 故意制造 3 行坏数据，用来演示真校验：2 行校验位错、1 行重复
      if (i === 4 || i === 11) id = id.slice(0, 17) + (id[17] === '9' ? '8' : '9');
      if (i === 16) id = mkId('1970', '03', '08', '135');
      if (i === 17) id = mkId('1970', '03', '08', '135');
      rows.push([
        SN[i % SN.length] + GN[i % GN.length],
        id,
        '138' + String(10000000 + i * 137913).slice(0, 8),
        TAG[i % TAG.length],
        TOWNS[i % TOWNS.length],
        ['公安分局', '区信访办', '区卫健委', '区司法局'][i % 4],
        LV[i % LV.length],
        i % 5 === 0 ? '需联合随访' : ''
      ]);
    }
    return rows;
  }

  return { read, validate, guessMap, idValid, idBirth, FIELDS, sampleCSV, ext, sizeText };
})();
