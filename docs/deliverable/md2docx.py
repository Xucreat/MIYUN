#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Markdown -> DOCX 转换（政务方案文档排版）"""
import re, sys, os, glob
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.section import WD_SECTION
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
from docx.enum.text import WD_BREAK

CN_BODY = "仿宋_GB2312"
CN_HEAD = "黑体"
CN_TABLE = "宋体"
LATIN = "Times New Roman"
MONO = "Consolas"


def set_run_font(run, cn=CN_BODY, latin=LATIN, size=12, bold=False, color=None):
    run.font.name = latin
    run.font.size = Pt(size)
    run.bold = bold
    rPr = run._element.get_or_add_rPr()
    rFonts = rPr.find(qn('w:rFonts'))
    if rFonts is None:
        rFonts = OxmlElement('w:rFonts'); rPr.append(rFonts)
    rFonts.set(qn('w:eastAsia'), cn)
    rFonts.set(qn('w:ascii'), latin)
    rFonts.set(qn('w:hAnsi'), latin)
    if color:
        run.font.color.rgb = RGBColor(*color)


def add_page_number(paragraph):
    run = paragraph.add_run()
    fld1 = OxmlElement('w:fldChar'); fld1.set(qn('w:fldCharType'), 'begin')
    instr = OxmlElement('w:instrText'); instr.set(qn('xml:space'), 'preserve'); instr.text = 'PAGE'
    fld2 = OxmlElement('w:fldChar'); fld2.set(qn('w:fldCharType'), 'end')
    run._r.append(fld1); run._r.append(instr); run._r.append(fld2)
    set_run_font(run, size=9)


def shade(cell, hexcolor):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear'); shd.set(qn('w:color'), 'auto'); shd.set(qn('w:fill'), hexcolor)
    tcPr.append(shd)


def set_cell_margins(table, top=40, bottom=40, left=80, right=80):
    tblPr = table._tbl.tblPr
    mar = OxmlElement('w:tblCellMar')
    for side, val in (('top', top), ('left', left), ('bottom', bottom), ('right', right)):
        el = OxmlElement('w:' + side); el.set(qn('w:w'), str(val)); el.set(qn('w:type'), 'dxa')
        mar.append(el)
    tblPr.append(mar)


def add_inline(par, text, size=12, cn=CN_BODY, base_bold=False):
    """处理 **bold** 与 `code`"""
    # 中文粗体后不留空格
    text = re.sub(r'(\*\*[^*]*?[\u4e00-\u9fa5、，。；：）】」！？])\*\*[ \t]+', r'\1**', text)
    tokens = re.split(r'(\*\*[^*]+\*\*|`[^`]+`)', text)
    for tk in tokens:
        if not tk:
            continue
        if tk.startswith('**') and tk.endswith('**') and len(tk) > 4:
            r = par.add_run(tk[2:-2]); set_run_font(r, cn=cn, size=size, bold=True)
        elif tk.startswith('`') and tk.endswith('`') and len(tk) > 2:
            r = par.add_run(tk[1:-1]); set_run_font(r, cn=cn, latin=MONO, size=size - 0.5)
        else:
            r = par.add_run(tk); set_run_font(r, cn=cn, size=size, bold=base_bold)


def dwidth(s):
    """显示宽度，全角计 2"""
    w = 0
    for ch in str(s):
        w += 2 if ord(ch) > 127 else 1
    return w


def autofit_size(code_lines, avail_pt=436.0, max_size=8.5, min_size=5.5):
    """按最长行自适应等宽字号"""
    if not code_lines:
        return max_size
    maxw = max(dwidth(l) for l in code_lines) or 1
    size = avail_pt * 2.0 / maxw
    return max(min_size, min(max_size, size))


def set_table_fixed(table, header, rows, total_cm=15.4):
    """固定列宽：按各列内容显示宽度的 85 分位按比例分配"""
    ncol = len(header)
    table.autofit = False
    weights = []
    for c in range(ncol):
        vals = [dwidth(header[c])]
        for r in rows:
            if c < len(r):
                vals.append(dwidth(r[c]))
        vals.sort()
        p = vals[max(0, int(len(vals) * 0.85) - 1)] if len(vals) > 3 else max(vals)
        weights.append(max(p, 5))
    s = sum(weights) or 1
    widths = [max(1.5, total_cm * w / s) for w in weights]
    # 归一化，避免超宽
    scale = total_cm / sum(widths)
    widths = [w * scale for w in widths]
    for c, w in enumerate(widths):
        table.columns[c].width = Cm(w)
        for cell in table.columns[c].cells:
            cell.width = Cm(w)
    # 表头重复
    trPr = table.rows[0]._tr.get_or_add_trPr()
    th = OxmlElement('w:tblHeader'); th.set(qn('w:val'), 'true'); trPr.append(th)
    # 行内不跨页
    for row in table.rows:
        p = row._tr.get_or_add_trPr()
        cs = OxmlElement('w:cantSplit'); p.append(cs)


def is_table_sep(line):
    return bool(re.match(r'^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$', line))


def split_row(line):
    s = line.strip()
    if s.startswith('|'): s = s[1:]
    if s.endswith('|'): s = s[:-1]
    return [c.strip() for c in s.split('|')]


def convert(md_path, out_path, doc_title):
    with open(md_path, encoding='utf-8') as f:
        lines = f.read().split('\n')

    doc = Document()

    # 页面设置 A4
    sec = doc.sections[0]
    sec.page_width = Cm(21.0); sec.page_height = Cm(29.7)
    sec.top_margin = Cm(2.54); sec.bottom_margin = Cm(2.54)
    sec.left_margin = Cm(3.0); sec.right_margin = Cm(2.6)

    # 正文默认样式
    st = doc.styles['Normal']
    st.font.name = LATIN; st.font.size = Pt(12)
    st.element.rPr.rFonts.set(qn('w:eastAsia'), CN_BODY)
    st.paragraph_format.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
    st.paragraph_format.line_spacing = 1.5
    st.paragraph_format.space_after = Pt(0)

    # 标题样式
    for lvl, sz in ((1, 18), (2, 15), (3, 13), (4, 12)):
        hs = doc.styles['Heading %d' % lvl]
        hs.font.name = LATIN; hs.font.size = Pt(sz); hs.font.bold = True
        hs.font.color.rgb = RGBColor(0, 0, 0)
        hs.element.rPr.rFonts.set(qn('w:eastAsia'), CN_HEAD)
        hs.paragraph_format.space_before = Pt(12 if lvl <= 2 else 8)
        hs.paragraph_format.space_after = Pt(6)
        hs.paragraph_format.line_spacing = 1.5

    # 页眉
    hp = sec.header.paragraphs[0]
    hp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = hp.add_run(doc_title); set_run_font(r, cn=CN_TABLE, size=9)
    # 页脚
    fp = sec.footer.paragraphs[0]
    fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = fp.add_run('— '); set_run_font(r, size=9)
    add_page_number(fp)
    r = fp.add_run(' —'); set_run_font(r, size=9)

    i = 0
    first_h1 = True
    in_code = False
    code_buf = []
    n = len(lines)

    while i < n:
        line = lines[i]

        # 代码块
        if line.strip().startswith('```'):
            if not in_code:
                in_code = True; code_buf = []; i += 1; continue
            if in_code:
                in_code = False
                size = autofit_size(code_buf)
                p = doc.add_paragraph()
                p.paragraph_format.line_spacing = 1.0
                p.paragraph_format.space_before = Pt(4)
                p.paragraph_format.space_after = Pt(4)
                p.paragraph_format.left_indent = Cm(0.2)
                # 浅灰底
                pPr = p._p.get_or_add_pPr()
                shd = OxmlElement('w:shd'); shd.set(qn('w:val'), 'clear')
                shd.set(qn('w:color'), 'auto'); shd.set(qn('w:fill'), 'F5F5F5')
                pPr.append(shd)
                for k, cl in enumerate(code_buf):
                    if k > 0:
                        p.add_run().add_break()
                    r = p.add_run(cl)
                    set_run_font(r, cn=CN_TABLE, latin=MONO, size=size)
                i += 1; continue
        if in_code:
            code_buf.append(line); i += 1; continue

        # 空行
        if not line.strip():
            i += 1; continue

        # 分隔线
        if re.match(r'^\s*(---|___|\*\*\*)\s*$', line):
            i += 1; continue

        # 标题
        m = re.match(r'^(#{1,6})\s+(.*)$', line)
        if m:
            lvl = len(m.group(1)); text = m.group(2).strip()
            if lvl == 1 and first_h1:
                first_h1 = False
                p = doc.add_paragraph()
                p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                p.paragraph_format.space_before = Pt(24)
                p.paragraph_format.space_after = Pt(12)
                add_inline(p, text, size=20, cn=CN_HEAD, base_bold=True)
                i += 1; continue
            if lvl == 2 and first_h1 is False and doc.paragraphs and \
               doc.paragraphs[-1].alignment == WD_ALIGN_PARAGRAPH.CENTER and \
               len(doc.paragraphs) <= 2:
                p = doc.add_paragraph()
                p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                p.paragraph_format.space_after = Pt(18)
                add_inline(p, text, size=16, cn=CN_HEAD, base_bold=True)
                p.add_run().add_break(WD_BREAK.PAGE)
                i += 1; continue
            h = doc.add_heading(level=min(lvl, 4))
            add_inline(h, text, size={1: 18, 2: 15, 3: 13, 4: 12}[min(lvl, 4)], cn=CN_HEAD, base_bold=True)
            i += 1; continue

        # 表格
        if line.strip().startswith('|') and i + 1 < n and is_table_sep(lines[i + 1]):
            header = split_row(line)
            i += 2
            rows = []
            while i < n and lines[i].strip().startswith('|'):
                rows.append(split_row(lines[i])); i += 1
            ncol = len(header)
            table = doc.add_table(rows=1, cols=ncol)
            table.style = 'Table Grid'
            table.alignment = WD_TABLE_ALIGNMENT.CENTER
            set_cell_margins(table)
            hdr = table.rows[0].cells
            for c, txt in enumerate(header):
                hdr[c].text = ''
                par = hdr[c].paragraphs[0]
                par.alignment = WD_ALIGN_PARAGRAPH.CENTER
                par.paragraph_format.line_spacing = 1.0
                add_inline(par, txt, size=9, cn=CN_TABLE, base_bold=True)
                shade(hdr[c], 'DCE6F1')
            for rw in rows:
                cells = table.add_row().cells
                for c in range(ncol):
                    val = rw[c] if c < len(rw) else ''
                    cells[c].text = ''
                    par = cells[c].paragraphs[0]
                    par.paragraph_format.line_spacing = 1.0
                    par.paragraph_format.space_after = Pt(0)
                    add_inline(par, val, size=9, cn=CN_TABLE)
            set_table_fixed(table, header, rows, total_cm=15.4)
            sp = doc.add_paragraph()
            sp.paragraph_format.space_after = Pt(0)
            sp.paragraph_format.line_spacing = 0.6
            continue

        # 引用块
        if line.strip().startswith('>'):
            text = line.strip().lstrip('>').strip()
            p = doc.add_paragraph()
            p.paragraph_format.left_indent = Cm(0.6)
            p.paragraph_format.line_spacing = 1.4
            add_inline(p, text, size=10.5, cn=CN_TABLE)
            i += 1; continue

        # 列表
        m = re.match(r'^(\s*)([-*+]|\d+\.)\s+(.*)$', line)
        if m:
            indent, marker, text = m.group(1), m.group(2), m.group(3)
            lvl = len(indent) // 2
            style = 'List Number' if marker[0].isdigit() else 'List Bullet'
            try:
                p = doc.add_paragraph(style=style)
            except KeyError:
                p = doc.add_paragraph()
            p.paragraph_format.left_indent = Cm(0.75 + 0.6 * lvl)
            p.paragraph_format.line_spacing = 1.5
            p.paragraph_format.space_after = Pt(0)
            add_inline(p, text, size=12)
            i += 1; continue

        # 普通段落
        p = doc.add_paragraph()
        p.paragraph_format.first_line_indent = Cm(0.74)
        p.paragraph_format.line_spacing = 1.5
        p.paragraph_format.space_after = Pt(0)
        add_inline(p, line.strip(), size=12)
        i += 1

    doc.save(out_path)
    return out_path


def main():
    src_dir = sys.argv[1]
    out_dir = sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)
    files = sorted(glob.glob(os.path.join(src_dir, '*.md')))
    for f in files:
        name = os.path.splitext(os.path.basename(f))[0]
        # 取标题用于页眉
        with open(f, encoding='utf-8') as fh:
            head = fh.read(400)
        m = re.search(r'^##\s+(.+)$', head, re.M)
        title = m.group(1).strip() if m else name
        title = re.sub(r'[#*`]', '', title)
        out = os.path.join(out_dir, name + '.docx')
        try:
            convert(f, out, title)
            print('OK  ', os.path.basename(out))
        except Exception as e:
            print('FAIL', name, e)


if __name__ == '__main__':
    main()
