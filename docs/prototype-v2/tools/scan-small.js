/* 盘点 card-ft / foot-note / note 块：输出文件、行号、内部含有的交互元素与文字 */
const fs = require('fs');

function findBlocks(src, startRe) {
  const out = [];
  let m;
  const re = new RegExp(startRe, 'g');
  while ((m = re.exec(src))) {
    const start = m.index;
    // 从 start 处开始做 div 配对
    let i = start, depth = 0, end = -1;
    const tagRe = /<div\b|<\/div>/g;
    tagRe.lastIndex = start;
    let t;
    while ((t = tagRe.exec(src))) {
      if (t[0] === '</div>') {
        depth--;
        if (depth === 0) { end = t.index + 6; break; }
      } else depth++;
    }
    if (end < 0) break;
    out.push({ start, end, html: src.slice(start, end) });
    re.lastIndex = end;
  }
  return out;
}

function lineOf(src, idx) { return src.slice(0, idx).split(/\r?\n/).length; }
function txt(s) { return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }

const files = fs.readdirSync('.').filter(f => f.endsWith('.html'));
['card-ft', 'foot-note', 'note'].forEach(cls => {
  console.log('\n########## .' + cls + ' ##########');
  files.forEach(f => {
    const src = fs.readFileSync(f, 'utf8');
    const re = cls === 'card-ft' ? '<div class="card-ft"' :
      cls === 'foot-note' ? '<div class="foot-note"' : '<div class="note[ "]';
    const blocks = findBlocks(src, re);
    if (!blocks.length) return;
    blocks.forEach(b => {
      const inner = b.html.replace(/^<div[^>]*>/, '').replace(/<\/div>$/, '');
      const hasBtn = /<button|<a\s|<span class="tag|<span class="btn|<span class="chip/.test(inner);
      const t = txt(inner);
      console.log(`${f}:${lineOf(src, b.start)} ${hasBtn ? '[含交互]' : '[纯文字]'} ${t.slice(0, 100)}`);
    });
  });
});
