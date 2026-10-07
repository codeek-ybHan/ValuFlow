"""RenderModel(JSON) → PDF (A4). HTML Renderer 와 같은 RenderModel 을 그린다: 숫자는 모두 RenderModel 의 표시 문자열이고 이 모듈은 값을 계산하거나 다시 서식화하지 않는다.
(차트의 막대 길이 같은 기하만 값에서 계산한다.) 외부 API · LLM 을 호출하지 않는다."""
from __future__ import annotations

import io
from typing import Any
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.platypus import BaseDocTemplate, CondPageBreak, Frame, KeepTogether, PageBreak, PageTemplate, Paragraph, Spacer, Table, TableStyle

from .charts import draw_chart
from .fonts import FontSet, fit, load_fonts

RENDER_MODEL_VERSION = "1.0"
MAX_BLOCKS = 3000
BLOCK_TYPES = {"cover", "banner", "heading", "notice", "paragraph", "kpis", "keyvalues", "table", "chart", "narrative", "list", "sources"}


class ReportError(Exception):
    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


def validate_render_model(rm: Any) -> None:
    if not isinstance(rm, dict) or rm.get("version") != RENDER_MODEL_VERSION:
        raise ReportError("unsupported-render-model", f"RenderModel version {RENDER_MODEL_VERSION} 만 지원합니다.", 422)
    if not isinstance(rm.get("meta"), dict) or not isinstance(rm.get("blocks"), list):
        raise ReportError("invalid-render-model", "RenderModel 형식이 올바르지 않습니다.", 422)
    if len(rm["blocks"]) > MAX_BLOCKS:
        raise ReportError("render-model-too-large", "Report 가 너무 큽니다.", 413)
    for b in rm["blocks"]:
        if not isinstance(b, dict) or b.get("type") not in BLOCK_TYPES:
            raise ReportError("invalid-render-model", "알 수 없는 block 입니다.", 422)


def _markers(ms: list[str]) -> str:
    return "".join(f'<super rise="3" size="6">[{escape(m)}]</super>' for m in ms)


class _Numbered(rl_canvas.Canvas):
    """'Page n / N' 을 위해 전체 페이지 수를 안 뒤에 footer 를 그린다."""

    footer_text = ""
    header_text = ""
    fonts: FontSet

    def __init__(self, *a: Any, **k: Any):
        super().__init__(*a, **k)
        self._saved: list[dict[str, Any]] = []

    def showPage(self) -> None:  # noqa: N802
        self._saved.append(dict(self.__dict__))
        self._startPage()

    def save(self) -> None:
        n = len(self._saved)
        for state in self._saved:
            self.__dict__.update(state)
            self._decorate(n)
            super().showPage()
        super().save()

    def _decorate(self, total: int) -> None:
        w, h = A4
        page = self._pageNumber
        self.setFont(self.fonts.regular, 7)
        self.setFillColor(colors.HexColor("#666666"))
        if page > 1:
            self.drawString(16 * mm, h - 11 * mm, fit(self.header_text, self.fonts))
            self.setStrokeColor(colors.HexColor("#cccccc"))
            self.line(16 * mm, h - 12.5 * mm, w - 16 * mm, h - 12.5 * mm)
        self.setStrokeColor(colors.HexColor("#cccccc"))
        self.line(16 * mm, 13 * mm, w - 16 * mm, 13 * mm)
        self.drawString(16 * mm, 9 * mm, fit(self.footer_text, self.fonts))
        self.drawRightString(w - 16 * mm, 9 * mm, f"Page {page} / {total}")


def render_pdf(rm: dict[str, Any]) -> tuple[bytes, dict[str, str]]:
    """RenderModel → (PDF bytes, info). info: font kind(ttf-embedded | cid-fallback), pages."""
    validate_render_model(rm)
    fonts = load_fonts()
    meta = rm["meta"]
    F, FB = fonts.regular, fonts.bold
    ink, muted, line = colors.HexColor("#1c1e22"), colors.HexColor("#666666"), colors.HexColor("#d0d0cb")
    base = ParagraphStyle("base", fontName=F, fontSize=8.5, leading=12.2, textColor=ink, alignment=TA_LEFT, wordWrap="CJK")
    st = {
        "p": base, "muted": ParagraphStyle("muted", parent=base, textColor=muted, fontSize=7.8, leading=11),
        "h1": ParagraphStyle("h1", parent=base, fontName=FB, fontSize=14, leading=18, spaceBefore=12, spaceAfter=6, keepWithNext=1),
        "h3": ParagraphStyle("h3", parent=base, fontName=FB, fontSize=9.5, leading=13, spaceBefore=8, spaceAfter=3, keepWithNext=1),
        "cap": ParagraphStyle("cap", parent=base, fontName=FB, fontSize=8.5, spaceBefore=6, spaceAfter=3, keepWithNext=1),
        "cell": ParagraphStyle("cell", parent=base, fontSize=7.8, leading=10.4), "cellr": ParagraphStyle("cellr", parent=base, fontSize=7.8, leading=10.4, alignment=TA_RIGHT),
        "th": ParagraphStyle("th", parent=base, fontName=FB, fontSize=7.8, leading=10.4), "thr": ParagraphStyle("thr", parent=base, fontName=FB, fontSize=7.8, leading=10.4, alignment=TA_RIGHT),
        "small": ParagraphStyle("small", parent=base, fontSize=6.5, leading=8, textColor=muted), "smallr": ParagraphStyle("smallr", parent=base, fontSize=6.5, leading=8, textColor=muted, alignment=TA_RIGHT),
        "kpiv": ParagraphStyle("kpiv", parent=base, fontName=FB, fontSize=11, leading=14), "kpil": ParagraphStyle("kpil", parent=base, fontSize=7, leading=9, textColor=muted),
        "title": ParagraphStyle("title", parent=base, fontName=FB, fontSize=30, leading=36), "eyebrow": ParagraphStyle("eyebrow", parent=base, fontName=FB, fontSize=8, textColor=muted),
        "cover2": ParagraphStyle("cover2", parent=base, fontSize=13, leading=17), "coversub": ParagraphStyle("coversub", parent=base, fontSize=11, leading=15, textColor=colors.HexColor("#444444")),
    }
    usable = A4[0] - 32 * mm

    def P(text: str, style: str = "p", raw: bool = False) -> Paragraph:
        return Paragraph(text if raw else escape(fit(text, fonts)), st[style])

    def cell_markup(c: dict[str, Any]) -> str:
        if c.get("text") is None:
            return '—'
        t = escape(fit(c["text"], fonts))
        if c.get("flag") in ("base", "total"):
            t = f"<b>{t}</b>"
        if c.get("flag") == "base":
            t += ' <font size="6" color="#000000"><b>[Base]</b></font>'
        if c.get("flag") == "invalid":
            t += ' <font size="6">[invalid]</font>'
        t += _markers(c.get("markers", []))
        if c.get("alt"):   # 조원 보조 표기는 둘째 줄 (값 · 마커와 섞이지 않게)
            t += f'<br/><font size="6.3" color="#666666">({escape(fit(c["alt"], fonts))})</font>'
        return t

    story: list[Any] = []
    last_break = [True]

    def add(x: Any) -> None:
        story.append(x)
        last_break[0] = isinstance(x, PageBreak)

    def box(flowables: list[Any], bg: str, border: str) -> Table:
        t = Table([[flowables]], colWidths=[usable])
        t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(bg)), ("BOX", (0, 0), (-1, -1), 1.2, colors.HexColor(border)), ("LEFTPADDING", (0, 0), (-1, -1), 8), ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]))
        t.keepWithNext = 1  # type: ignore[attr-defined]
        return t

    def build_table(b: dict[str, Any]) -> Any:
        cols = b["columns"]
        period = any(c.get("kindLabel") for c in cols)
        head = []
        for i, c in enumerate(cols):
            right = c["align"] == "right"
            k = f'<br/><font size="6" color="#666666">{escape(c["kindLabel"])}</font>' if c.get("kindLabel") else ""
            head.append(Paragraph(escape(fit(c["label"], fonts)) + k, st["thr" if right else "th"]))
        data = [head]
        flag_cells: list[tuple[int, int]] = []
        total_rows: list[int] = []
        for ri, r in enumerate(b["rows"], start=1):
            label = (f'<b>{escape(r["operator"])}</b> ' if r.get("operator") else "") + escape(fit(r["label"], fonts))
            if not period and r.get("kindLabel"):
                label += f' <font size="6" color="#666666">{escape(r["kindLabel"])}</font>'
            if r.get("note"):
                label += f'<br/><font size="6.3" color="#666666">{escape(fit(r["note"], fonts))}</font>'
            row = [Paragraph(label, st["cell"])]
            for ci, c in enumerate(r["cells"], start=1):
                right = (cols[ci]["align"] if ci < len(cols) else "right") == "right"
                row.append(Paragraph(cell_markup(c), st["cellr" if right else "cell"]))
                if c.get("flag") == "base":
                    flag_cells.append((ci, ri))
            data.append(row)
            if r.get("emphasis"):
                total_rows.append(ri)
        n = len(cols)
        first = min(usable * 0.36, 175.0) if n > 2 else usable * 0.5
        rest = (usable - first) / max(1, n - 1)
        t = Table(data, colWidths=[first] + [rest] * (n - 1), repeatRows=1, splitByRow=1)
        cmds: list[Any] = [("LINEBELOW", (0, 0), (-1, 0), 1.2, colors.HexColor("#2a2e35")), ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f1f1ee")), ("LINEBELOW", (0, 1), (-1, -1), 0.4, line),
                           ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 4), ("RIGHTPADDING", (0, 0), (-1, -1), 4), ("TOPPADDING", (0, 0), (-1, -1), 2.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5)]
        for ri in total_rows:
            cmds.append(("LINEABOVE", (0, ri), (-1, ri), 0.9, colors.HexColor("#2a2e35")))
        for ci, ri in flag_cells:
            cmds.append(("BOX", (ci, ri), (ci, ri), 1.6, colors.black))
        t.setStyle(TableStyle(cmds))
        head_items: list[Any] = [Paragraph(escape(fit(b["title"], fonts)) + _markers(b.get("markers", [])), st["cap"])]
        head_items += [P(n, "muted") for n in b.get("notices", [])]
        return [KeepTogether(head_items + [t])] if len(data) <= 14 else head_items + [t]

    for b in rm["blocks"]:
        t = b["type"]
        if t == "cover":
            add(Spacer(1, 38 * mm))
            add(P("VALUATION REPORT", "eyebrow"))
            add(P(b["company"], "title"))
            add(P(b["title"], "cover2"))
            if b.get("subtitle"):
                add(P(b["subtitle"], "coversub"))
            add(Spacer(1, 10 * mm))
            rows = [[P("Company", "small"), P(f"{b['company']}{' (' + b['ticker'] + ')' if b.get('ticker') else ''}"), P("Valuation Date", "small"), P(b.get("valuationDate") or "-")],
                    [P("Created At", "small"), P(b["createdAt"]), P("Currency", "small"), P(b["currency"])],
                    [P("Monetary Unit", "small"), P(f"{b['monetaryUnit']} (주당 {b['perShareUnit']})"), P("Report Version", "small"), P(b["version"])]]
            tb = Table(rows, colWidths=[usable * 0.16, usable * 0.34, usable * 0.16, usable * 0.34])
            tb.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.4, line), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
            add(tb)
        elif t == "banner":
            add(Spacer(1, 8 * mm))
            add(box([Paragraph(f'<b>{escape(fit(b["title"], fonts))}</b>', st["p"]), P(b["text"], "p")], "#f6eed8", "#7a5a12"))
            add(PageBreak())
        elif t == "heading":
            if b.get("pageBreakBefore") and not last_break[0]:
                add(CondPageBreak(105 * mm))   # 새 쪽 선호(hint): 남은 공간이 충분하면 이어서 쓴다 (거의 빈 쪽을 만들지 않는다)
            num = f'{b["number"]}. ' if b.get("number") else ""
            h = Paragraph(f'{escape(num)}{escape(fit(b["text"], fonts))}', st["h1"])
            h._bookmark = (b["id"], f'{num}{b["text"]}')  # type: ignore[attr-defined]
            add(h)
        elif t == "notice":
            add(box([P(b["text"], "p")], "#faf5e6", "#7a5a12"))
            add(Spacer(1, 3))
        elif t == "paragraph":
            par = Paragraph(escape(fit(b["text"], fonts)) + _markers(b.get("markers", [])), st["muted" if b.get("muted") else "p"])
            prev = story[-2] if len(story) >= 2 and isinstance(story[-1], Spacer) else None
            if b.get("muted") and isinstance(prev, KeepTogether):   # 표 · 차트 바로 뒤의 보조 설명은 그 표와 같은 쪽에 둔다
                prev._content.append(Spacer(1, 2))
                prev._content.append(par)
            else:
                add(par)
            add(Spacer(1, 3))
        elif t == "kpis":
            items = b["items"]
            cells = [[P(k["label"], "kpil"), Paragraph(cell_markup(k["value"]).replace("<b>", "").replace("</b>", ""), st["kpiv"]), P(k["value"].get("alt") or " ", "small")] for k in items]
            tb = Table([[c for c in cells]], colWidths=[usable / max(1, len(items))] * len(items))
            tb.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.6, line), ("INNERGRID", (0, 0), (-1, -1), 0.6, line), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
            add(tb)
            add(Spacer(1, 4))
        elif t == "keyvalues":
            if b.get("title"):
                add(P(b["title"], "h3"))
            rows = []
            for i in b["items"]:
                lab = escape(fit(i["label"], fonts)) + (f' <font size="6" color="#666666">{escape(i["kindLabel"])}</font>' if i.get("kindLabel") else "")
                val = escape(fit(i["value"]["text"], fonts)) if i["value"].get("text") is not None else f'— <font size="6.5" color="#666666">{escape(fit(i["value"].get("reason") or "", fonts))}</font>'
                if i["value"].get("alt"):
                    val += f' <font size="6.5" color="#666666">({escape(fit(i["value"]["alt"], fonts))})</font>'
                rows.append([Paragraph(lab, st["cell"]), Paragraph((f"<b>{val}</b>" if i.get("emphasis") else val) + _markers(i["value"].get("markers", [])), st["cell"])])
            tb = Table(rows, colWidths=[usable * 0.34, usable * 0.66])
            tb.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.4, line), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 2.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5)]))
            add(tb)
            add(Spacer(1, 4))
        elif t == "table":
            for x in build_table(b):
                add(x)
            add(Spacer(1, 5))
        elif t == "chart":
            ch = b["chart"]
            d = draw_chart(ch, fonts)
            add(KeepTogether([Paragraph(escape(fit(ch["title"], fonts)) + _markers(ch.get("markers", [])), st["cap"]), d, Spacer(1, 4)]))
        elif t == "narrative":
            add(P(b["title"], "h3"))
            for i in b["items"]:
                badge = "FACT" if i["label"] == "Fact" else "JUDGMENT"
                txt = f'<b>[{badge}]</b> ' + (escape(fit(i["text"], fonts)) if i["label"] == "Fact" else f'<i>{escape(fit(i["text"], fonts))}</i>') + _markers(i.get("markers", []))
                if i.get("confidence"):
                    txt += f' <font size="6.5" color="#666666">{escape(i["confidence"])} Confidence</font>'
                add(Paragraph(txt, st["p"], bulletText="•"))
            if b.get("note"):
                add(P(b["note"], "muted"))
            add(Spacer(1, 3))
        elif t == "list":
            if b.get("title"):
                add(P(b["title"], "h3"))
            for i in b["items"]:
                add(Paragraph(escape(fit(i["text"], fonts)) + _markers(i.get("markers", [])) + (f' <font size="6.5" color="#666666">{escape(fit(i["note"], fonts))}</font>' if i.get("note") else ""), st["p"], bulletText="•"))
            add(Spacer(1, 3))
        elif t == "sources":
            for e in b["entries"]:
                parts = [f'<b>[{escape(e["marker"])}]</b> {escape(fit(e["label"], fonts))} <font size="6.5" color="#666666">{escape(e["type"])}</font>']
                if e.get("asOf"):
                    parts.append(f' · as of {escape(e["asOf"])}')
                if e.get("provider"):
                    parts.append(f' · {escape(e["provider"])}' + (f' ({escape(e["reliability"])})' if e.get("reliability") else ""))
                body = "".join(parts)
                if e.get("reference"):
                    body += f'<br/><font size="7" color="#555555">{escape(fit(e["reference"], fonts))}</font>'
                if e.get("url"):
                    body += f'<br/><font size="7" color="#555555">{escape(e["url"])}</font>'
                if e.get("notice"):
                    body += f'<br/><font size="7" color="#7a5a12"><b>{escape(fit(e["notice"], fonts))}</b></font>'
                add(KeepTogether([Paragraph(body, st["p"]), Spacer(1, 4)]))

    buf = io.BytesIO()

    class Doc(BaseDocTemplate):
        def afterFlowable(self, flowable: Any) -> None:  # noqa: N802  (PDF 목차 · 북마크)
            bm = getattr(flowable, "_bookmark", None)
            if bm:
                key, title = bm
                self.canv.bookmarkPage(key)
                self.canv.addOutlineEntry(fit(title, fonts), key, 0, 0)

    doc = Doc(buf, pagesize=A4, leftMargin=16 * mm, rightMargin=16 * mm, topMargin=18 * mm, bottomMargin=18 * mm,
              title=meta.get("title", "Valuation Report"), author="ValuFlow", subject=f'{meta.get("company", "")} valuation report (created {meta.get("createdAt", "")})',
              keywords=f'{meta.get("reportId", "")}; schema {meta.get("schemaVersion", "")}; template {meta.get("templateId", "")} v{meta.get("templateVersion", "")}', creator="ValuFlow report renderer")
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="f", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    doc.addPageTemplates([PageTemplate(id="p", frames=[frame])])

    header = f'{meta.get("company", "")} · {meta.get("title", "")}'
    footer = meta.get("footer", "")

    class Canvas(_Numbered):
        pass
    Canvas.footer_text, Canvas.header_text, Canvas.fonts = footer, header, fonts
    doc.build(story, canvasmaker=Canvas)
    data = buf.getvalue()
    from pypdf import PdfReader
    return data, {"font": fonts.kind, "pages": str(len(PdfReader(io.BytesIO(data)).pages))}
