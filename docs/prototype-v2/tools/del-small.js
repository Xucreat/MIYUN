/* 删除灰色小字：.foot-note 整块、.note 整块、.card-ft 中的纯文字部分（保留按钮/链接/标签） */
const fs = require('fs');

const SKIP = new Set(['index.html']); /* 封面页：说明与页脚是该页唯一内容，保留 */

function findBlocks(src, startRe) {
  const out = [];
  const re = new RegExp(startRe, 'g');
  let m;
  while ((m = re.exec(src))) {
    const start = m.index;
    let depth = 0, end = -1;
    const tagRe = /<div\b|<\/div>/g;
    tagRe.lastIndex = start;
    let t;
    while ((t = tagRe.exec(src))) {
      if (t[0] === '</div>') { depth--; if (depth === 0) { end = t.index + 6; break; } }
      else depth++;
    }
    if (end < 0) break;
    out.push({ start, end, html: src.slice(start, end) });
    re.lastIndex = end;
  }
  return out;
}

/* 把 innerHTML 拆成顶层片段（元素或文本） */
function splitTop(inner) {
  const parts = [];
  let i = 0;
  while (i < inner.length) {
    if (inner[i] === '<') {
      const tag = inner.slice(i).match(/^<(\/?)([a-zA-Z0-9]+)/);
      if (!tag) { parts.push({ text: inner.slice(i) }); break; }
      if (tag[1] === '/') { /* 不应出现孤立闭合 */ parts.push({ text: inner[i] }); i++; continue; }
      const name = tag[2].toLowerCase();
      if (['br', 'img', 'input', 'hr', 'i'].includes(name) && /\/?>$/.test(inner.slice(i, inner.indexOf('>', i) + 1))) {
        const e = inner.indexOf('>', i) + 1;
        parts.push({ raw: inner.slice(i, e) });
        i = e; continue;
      }
      /* 配对（同标签计数，粗略但够用） */
      const openRe = new RegExp('<' + name + '\\b', 'gi');
      const closeRe = new RegExp('</' + name + '>', 'gi');
      let depth = 0, j = i, endPos = -1;
      while (j < inner.length) {
        const lt = inner.indexOf('<', j);
        if (lt < 0) break;
        if (/^<[a-zA-Z]/.test(inner.slice(lt))) {
          const nm = inner.slice(lt).match(/^<([a-zA-Z0-9]+)/);
          if (nm && nm[1].toLowerCase() === name && !/\/>$/.test(inner.slice(lt, inner.indexOf('>', lt) + 1))) depth++;
        }
        if (inner.slice(lt, lt + name.length + 3).toLowerCase() === '</' + name + '>') {
          depth--;
          if (depth === 0) { endPos = lt + name.length + 3; break; }
        }
        j = inner.indexOf('>', lt) + 1;
      }
      if (endPos < 0) { parts.push({ text: inner.slice(i) }); break; }
      parts.push({ raw: inner.slice(i, endPos) });
      i = endPos;
    } else {
      const lt = inner.indexOf('<', i);
      const e = lt < 0 ? inner.length : lt;
      parts.push({ text: inner.slice(i, e) });
      i = e;
    }
  }
  return parts;
}

const KEEP = /(<button\b|<a\s|class="tag|class="btn|class="chip|class="spacer|id=")/;

function cleanCardFt(block) {
  const m = block.match(/^<div[^>]*>/);
  const openTag = m[0];
  const inner = block.slice(openTag.length, block.lastIndexOf('</div>'));
  const parts = splitTop(inner);
  const kept = parts.filter(p => {
    if (p.text !== undefined) return false;           /* 裸文本丢掉 */
    return KEEP.test(p.raw);                          /* 保留按钮/链接/标签 */
  }).filter(p => !/class="spacer"/.test(p.raw) || parts.length === 1);
  const rest = kept.map(p => p.raw).join('');
  const restText = rest.replace(/class="spacer"/g, '').replace(/<[^>]+>/g, '').trim();
  const hasInteractive = /<button\b|<a\s|class="tag|class="btn|class="chip/.test(rest);
  if (!hasInteractive) return { action: 'remove-whole', rest: '' };
  if (!restText && !/<button\b|<a\s/.test(rest)) return { action: 'remove-whole', rest: '' };
  return { action: 'rewrite', rest };
}

const files = fs.readdirSync('.').filter(f => f.endsWith('.html') && !SKIP.has(f));
let report = [];

files.forEach(f => {
  let src = fs.readFileSync(f, 'utf8');
  const before = src;
  const stats = { 'foot-note': 0, note: 0, 'card-ft-rm': 0, 'card-ft-rw': 0 };

  /* foot-note 与 note 整块删除（从后往前，避免位移） */
  ['foot-note', 'note[ "'].forEach((cls, idx) => {
    const key = idx === 0 ? 'foot-note' : 'note';
    const re = idx === 0 ? '<div class="foot-note"' : '<div class="note[ "]';
    const blocks = findBlocks(src, re);
    for (let i = blocks.length - 1; i >= 0; i--) {
      const b = blocks[i];
      /* 连同前面的缩进与后面的换行一起去掉 */
      let s = b.start, e = b.end;
      while (s > 0 && (src[s - 1] === ' ' || src[s - 1] === '\t')) s--;
      if (src[e] === '\r') e++;
      if (src[e] === '\n') e++;
      src = src.slice(0, s) + src.slice(e);
      stats[key]++;
    }
  });

  /* card-ft 清文字 */
  const blocks = findBlocks(src, '<div class="card-ft"');
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    const r = cleanCardFt(b.html);
    if (r.action === 'remove-whole') {
      let s = b.start, e = b.end;
      while (s > 0 && (src[s - 1] === ' ' || src[s - 1] === '\t')) s--;
      if (src[e] === '\r') e++;
      if (src[e] === '\n') e++;
      src = src.slice(0, s) + src.slice(e);
      stats['card-ft-rm']++;
    } else {
      const openTag = b.html.match(/^<div[^>]*>/)[0];
      src = src.slice(0, b.start) + openTag + r.rest + '</div>' + src.slice(b.end);
      stats['card-ft-rw']++;
    }
  }

  if (src !== before) {
    fs.writeFileSync(f, src);
    report.push(f + ' → ' + JSON.stringify(stats));
  }
});
console.log(report.join('\n'));
