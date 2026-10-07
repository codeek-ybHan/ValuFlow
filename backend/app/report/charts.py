"""ChartModel(dict) → reportlab Drawing (벡터). TypeScript 의 SVG 렌더러와 같은 규칙: 숫자를 새로 만들지 않는다(값 표시는 point.text 그대로, 축에 숫자 눈금 없음),
색에 의미를 두지 않는다(범례 문구 · 직접 값 라벨 · Base/invalid 문구와 테두리)."""
from __future__ import annotations

from typing import Any

from reportlab.graphics.shapes import Circle, Drawing, Line, PolyLine, Polygon, Rect, String
from reportlab.lib import colors

from .fonts import FontSet, fit

FILLS = [colors.HexColor("#2a2e35"), colors.HexColor("#8c929c"), colors.HexColor("#c6cad1"), colors.HexColor("#5b616b")]
GRID = colors.HexColor("#666666")
LIGHT = colors.HexColor("#bbbbbb")
W, H = 500.0, 210.0
L, R, T, B = 18.0, 18.0, 22.0, 40.0


def _num(p: dict[str, Any] | None) -> float | None:
    if not p or p.get("state") != "ok" or not isinstance(p.get("value"), (int, float)):
        return None
    return float(p["value"])


def _s(d: Drawing, x: float, y: float, text: str, fonts: FontSet, size: float = 7, anchor: str = "middle", bold: bool = False) -> None:
    d.add(String(x, y, fit(text, fonts), fontName=fonts.bold if bold else fonts.regular, fontSize=size, textAnchor=anchor, fillColor=colors.black))


def _legend(d: Drawing, chart: dict[str, Any], fonts: FontSet) -> None:
    for i, s in enumerate(chart.get("series", [])):
        x = L + i * 130
        d.add(Rect(x, 8, 7, 7, fillColor=FILLS[i % len(FILLS)], strokeColor=None))
        _s(d, x + 10, 9, s["label"], fonts, 7, "start")


def _empty(d: Drawing, fonts: FontSet) -> Drawing:
    _s(d, W / 2, H / 2, "표시할 값이 없습니다", fonts, 9)
    return d


def _bars(chart: dict[str, Any], fonts: FontSet, stacked: bool) -> Drawing:
    d = Drawing(W, H)
    series = chart["series"]
    vals = [v for s in series for p in s["points"] if (v := _num(p)) is not None]
    if not vals:
        return _empty(d, fonts)
    vmax, vmin = max(0.0, *vals), min(0.0, *vals)
    span = (vmax - vmin) or 1.0
    plot_h, plot_w = H - T - B, W - L - R
    y = lambda v: B + (v - vmin) / span * plot_h  # noqa: E731  (reportlab 은 y 가 위로 증가)
    cats = chart["categories"]
    gw = plot_w / max(1, len(cats))
    bw = min(40.0, gw * 0.7 / (1 if stacked else max(1, len(series))))
    d.add(Line(L, y(0), W - R, y(0), strokeColor=GRID, strokeWidth=0.8))
    for ci, cat in enumerate(cats):
        gx = L + ci * gw + gw / 2
        _s(d, gx, B - 14, cat, fonts, 7.5)
        acc = 0.0
        for si, s in enumerate(series):
            p = s["points"][ci]
            v = _num(p)
            x = gx - bw / 2 if stacked else gx - len(series) * bw / 2 + si * bw
            if v is None:
                _s(d, x + bw / 2, y(0) + 3, "—", fonts, 6)
                continue
            lo, hi = (acc, acc + v) if stacked else (min(0.0, v), max(0.0, v))
            d.add(Rect(x, y(lo), bw - 2, max(abs(y(hi) - y(lo)), 0.5), fillColor=FILLS[si % len(FILLS)], strokeColor=None))
            _s(d, x + (bw - 2) / 2, (y(hi) + 3) if v >= 0 else (y(lo) - 8), p.get("text") or "", fonts, 6)
            if stacked:
                acc += v
    _legend(d, chart, fonts)
    return d


def _lines(chart: dict[str, Any], fonts: FontSet) -> Drawing:
    d = Drawing(W, H)
    series = chart["series"]
    vals = [v for s in series for p in s["points"] if (v := _num(p)) is not None]
    if not vals:
        return _empty(d, fonts)
    vmax, vmin = max(vals), min(vals)
    span = (vmax - vmin) or 1.0
    plot_h, plot_w = H - T - B - 12, W - L - R
    y = lambda v: B + 6 + (v - vmin) / span * plot_h  # noqa: E731
    cats = chart["categories"]
    step = plot_w / max(1, len(cats))
    for i, cat in enumerate(cats):
        _s(d, L + i * step + step / 2, B - 14, cat, fonts, 7.5)
    for si, s in enumerate(series):
        run: list[float] = []
        def flush() -> None:
            nonlocal run
            if len(run) >= 4:
                d.add(PolyLine(run, strokeColor=FILLS[si % len(FILLS)], strokeWidth=1.6, strokeDashArray=None if si == 0 else ([5, 2] if si == 1 else [1.5, 2])))
            run = []
        for i, p in enumerate(s["points"]):
            v = _num(p)
            x = L + i * step + step / 2
            if v is None:
                flush()
                _s(d, x, B + 2, "—", fonts, 6)
                continue
            run += [x, y(v)]
        flush()
        for i, p in enumerate(s["points"]):
            v = _num(p)
            if v is None:
                continue
            x = L + i * step + step / 2
            d.add(Circle(x, y(v), 2.6, fillColor=FILLS[si % len(FILLS)], strokeColor=None))
            _s(d, x, (y(v) - 9) if si == 0 else (y(v) + 5), p.get("text") or "", fonts, 6)   # 첫 계열은 아래, 나머지는 위에 둬서 라벨이 겹치지 않게
    _legend(d, chart, fonts)
    return d


def _waterfall(chart: dict[str, Any], fonts: FontSet) -> Drawing:
    d = Drawing(W, H)
    steps = chart.get("waterfall") or []
    vals = [_num(s["point"]) for s in steps]
    if not steps or any(v is None for v in vals):
        return _empty(d, fonts)
    top = max(abs(v) for v in vals if v is not None) or 1.0
    plot_h = H - T - B
    y = lambda v: B + v / top * plot_h  # noqa: E731
    bw = 80.0
    gap = (W - L - R - bw * len(steps)) / max(1, len(steps) - 1)
    d.add(Line(L, y(0), W - R, y(0), strokeColor=GRID, strokeWidth=0.8))
    level = 0.0
    for i, s in enumerate(steps):
        v = float(vals[i])  # type: ignore[arg-type]
        x = L + i * (bw + gap)
        frm, to = 0.0, v
        if s["role"] == "start":
            level = v
        elif s["role"] == "delta":
            frm, to = level, (level - abs(v) if s.get("operator") == "-" else level + abs(v))
            level = to
        r = Rect(x, y(min(frm, to)), bw, max(abs(y(frm) - y(to)), 1.0), fillColor=colors.HexColor("#c6cad1") if s["role"] == "delta" else FILLS[0], strokeColor=FILLS[0], strokeWidth=0.8)
        if s["role"] == "delta":
            r.strokeDashArray = [3, 2]
        d.add(r)
        op = s.get("operator")
        _s(d, x + bw / 2, y(max(frm, to)) + 4, f"{op + ' ' if op else ''}{s['point'].get('text') or ''}", fonts, 8, bold=True)
        _s(d, x + bw / 2, B - 14, s["label"], fonts, 7.5)
    return d


def _heatmap(chart: dict[str, Any], fonts: FontSet) -> Drawing:
    hm = chart["heatmap"]
    rows, cols = hm["rowLabels"], hm["colLabels"]
    ch = 24.0
    height = T + 18 + len(rows) * ch + 10
    d = Drawing(W, height)
    flat = [c for r in hm["cells"] for c in r if c.get("value") is not None]
    vmin = min((c["value"] for c in flat), default=0.0)
    vmax = max((c["value"] for c in flat), default=1.0)
    span = (vmax - vmin) or 1.0
    cw = (W - 100) / max(1, len(cols))
    top = height - T
    _s(d, 6, top, "g \\ WACC", fonts, 7, "start")
    for i, lab in enumerate(cols):
        _s(d, 96 + i * cw + cw / 2, top, lab, fonts, 7.5)
    for r, rl in enumerate(rows):
        y0 = top - 8 - (r + 1) * ch
        _s(d, 90, y0 + ch / 2 - 3, rl, fonts, 7.5, "end")
        for i, cell in enumerate(hm["cells"][r]):
            shade = 1.0 if cell.get("value") is None else (246 - (cell["value"] - vmin) / span * 60) / 255.0
            x = 96 + i * cw
            rect = Rect(x, y0, cw - 2, ch - 2, fillColor=colors.Color(shade, shade, shade), strokeColor=colors.black if cell.get("isBaseCase") else LIGHT, strokeWidth=2.4 if cell.get("isBaseCase") else 0.6)
            if cell.get("flag") == "invalid":
                rect.strokeDashArray = [2, 2]
            d.add(rect)
            _s(d, x + (cw - 2) / 2, y0 + ch - 11, cell.get("text") or "—", fonts, 7)
            if cell.get("isBaseCase"):
                _s(d, x + (cw - 2) / 2, y0 + 3, "Base", fonts, 6.5, bold=True)
            elif cell.get("flag") == "invalid":
                _s(d, x + (cw - 2) / 2, y0 + 3, "invalid", fonts, 6.5)
    return d


def _range(chart: dict[str, Any], fonts: FontSet) -> Drawing:
    items = chart.get("range") or []
    row_h = 30.0
    height = T + len(items) * row_h + 8
    d = Drawing(W, height)
    vs = [v for it in items for v in (_num(it["low"]), _num(it["high"])) if v is not None]
    if not vs:
        return _empty(d, fonts)
    vmin, vmax = min(vs), max(vs)
    span = (vmax - vmin) or 1.0
    pl, pr = 150.0, W - 80
    x = lambda v: pl + (v - vmin) / span * (pr - pl)  # noqa: E731
    for i, it in enumerate(items):
        yy = height - T - i * row_h
        _s(d, 4, yy - 3, it["label"], fonts, 7.5, "start")
        lo, hi = _num(it["low"]), _num(it["high"])
        b = _num(it.get("base"))
        if lo is None or hi is None:
            _s(d, pl, yy - 3, "—", fonts, 8, "start")
            continue
        d.add(Line(x(lo), yy, x(hi), yy, strokeColor=FILLS[0], strokeWidth=3))
        d.add(Circle(x(lo), yy, 3, fillColor=FILLS[0], strokeColor=None))
        d.add(Circle(x(hi), yy, 3, fillColor=FILLS[0], strokeColor=None))
        _s(d, x(lo), yy + 6, f"Low {it['low'].get('text') or ''}", fonts, 6)
        _s(d, x(hi), yy + 6, f"High {it['high'].get('text') or ''}", fonts, 6)
        if b is not None:
            d.add(Polygon([x(b), yy + 5, x(b) + 5, yy, x(b), yy - 5, x(b) - 5, yy], fillColor=colors.white, strokeColor=colors.black, strokeWidth=1.6))
            _s(d, x(b), yy - 15, f"Base {it['base'].get('text') or ''}", fonts, 6, bold=True)
    return d


def draw_chart(chart: dict[str, Any], fonts: FontSet) -> Drawing:
    t = chart.get("type")
    if t in ("bar", "grouped-bar"):
        return _bars(chart, fonts, False)
    if t == "stacked-bar":
        return _bars(chart, fonts, True)
    if t == "line":
        return _lines(chart, fonts)
    if t == "waterfall":
        return _waterfall(chart, fonts)
    if t == "heatmap":
        return _heatmap(chart, fonts)
    if t == "range":
        return _range(chart, fonts)
    return _empty(Drawing(W, H), fonts)
