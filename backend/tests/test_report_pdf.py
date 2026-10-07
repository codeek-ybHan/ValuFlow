"""STEP 09-6: Report PDF — RenderModel(JSON) → A4 PDF. 한글 · 표 · 차트 · footnote · 페이지 번호 · 메타데이터 · 폰트 전략 · 오류 처리."""
from __future__ import annotations

import io
import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pypdf import PdfReader

from app.main import create_app
from app.report import fonts as fonts_mod
from app.report.pdf import ReportError, render_pdf, validate_render_model

KO = "삼성전자 Valuation Report"


def cell(text, markers=(), flag=None, alt=None, reason=None):
    return {"text": text, "alt": alt, "reason": reason, "markers": list(markers), "flag": flag}


def point(text, value, state="ok", flag=None):
    return {"value": value, "text": text, "state": state, "flag": flag}


def chart(kind, **kw):
    base = {"id": f"c-{kind}", "type": kind, "title": f"차트 {kind}", "categories": ["2025E", "2026E"], "series": [], "unit": "eok", "sourceIds": ["s"], "markers": ["S3"], "accessibleDescription": "설명"}
    base.update(kw)
    return base


def sample_model(blocks_extra=None):
    series = lambda key, label, vals: {"key": key, "label": label, "kind": "calculated", "unit": "eok", "points": [point(f"{v:,}억원", v) for v in vals]}
    blocks = [
        {"type": "cover", "title": KO, "subtitle": "As of 2026-10-08", "company": "삼성전자", "ticker": "005930", "createdAt": "2026-10-08T01:02:03Z", "valuationDate": "2026-10-08", "currency": "KRW", "monetaryUnit": "억원", "perShareUnit": "원", "version": "schema 1.0 / template 1.0"},
        {"type": "banner", "title": "Learning / Demonstration Data", "text": "이 보고서는 학습 · 시연용이며 실제 가치평가 보고서가 아닙니다."},
        {"type": "heading", "id": "sec-executiveSummary", "level": 1, "number": "1", "text": "Executive Summary", "status": "warning", "pageBreakBefore": False},
        {"type": "notice", "text": "Learning / Demonstration Data: 가정이 학습용 가상값입니다.", "kind": "learning"},
        {"type": "kpis", "items": [{"label": "Enterprise Value", "value": cell("2,346억원", ["S3"]), "kindLabel": "Calculated"}, {"label": "Value per Share", "value": cell("214,556원", ["S3"]), "kindLabel": "Calculated"}, {"label": "WACC", "value": cell("8.14%", ["S3"]), "kindLabel": "Calculated"}, {"label": "Revenue", "value": cell("3,336,059억원", ["S1"], alt="333.61조원"), "kindLabel": "Actual"}]},
        {"type": "narrative", "title": "Key Conclusion", "note": "검증을 통과하지 못한 AI claim 1건은 제외했습니다.", "items": [{"label": "Fact", "type": "Fact", "text": "2025년 영업이익률은 13.07%이다.", "confidence": "High", "markers": ["S1"]}, {"label": "Judgment", "type": "Interpretation", "text": "수익성 개선이 이어지고 있다.", "confidence": "Medium", "markers": ["S1", "S2"]}]},
        {"type": "heading", "id": "sec-historicalPerformance", "level": 1, "number": "2", "text": "Historical Financial Performance", "status": "ok", "pageBreakBefore": True},
        {"type": "table", "id": "hist", "title": "Historical (Actual)", "markers": ["S1"], "notices": [], "columns": [{"label": "항목", "align": "left", "kindLabel": None}, {"label": "2024A", "align": "right", "kindLabel": "Actual"}, {"label": "2025A", "align": "right", "kindLabel": "Actual"}],
         "rows": [{"label": "Revenue", "kindLabel": "Actual", "operator": None, "note": "KRW million → 억원", "emphasis": False, "cells": [cell("3,008,709억원", ["S1"], alt="300.87조원"), cell("3,336,059억원", ["S1"], alt="333.61조원")]},
                  {"label": "D&A", "kindLabel": "Actual", "operator": None, "note": None, "emphasis": False, "cells": [cell(None, reason="필요한 입력 계정이 없다"), cell(None, reason="필요한 입력 계정이 없다")]},
                  {"label": "Operating Margin", "kindLabel": "Calculated", "operator": None, "note": None, "emphasis": True, "cells": [cell("10.88%", ["S1"], flag="total"), cell("13.07%", ["S1"], flag="total")]}]},
        {"type": "chart", "id": "c1", "chart": chart("grouped-bar", series=[series("rev", "Revenue", [3008709, 3336059]), series("op", "Operating Profit", [327260, 436011])])},
        {"type": "chart", "id": "c2", "chart": chart("line", unit="ratio", series=[{"key": "m", "label": "Margin", "kind": "actual", "unit": "ratio", "points": [point("10.88%", 0.1088), point(None, None, "unavailable")]}])},
        {"type": "chart", "id": "c3", "chart": chart("waterfall", categories=["EV", "Net Debt", "Equity"], waterfall=[{"key": "ev", "label": "Enterprise Value", "operator": None, "role": "start", "point": point("2,346억원", 2346)}, {"key": "nd", "label": "Net Debt", "operator": "-", "role": "delta", "point": point("200억원", 200)}, {"key": "eq", "label": "Equity Value", "operator": "=", "role": "total", "point": point("2,146억원", 2146)}])},
        {"type": "chart", "id": "c4", "chart": chart("heatmap", heatmap={"rowLabels": ["2.00%", "2.50%"], "colLabels": ["8.00%", "8.14%"], "cells": [[{"value": 2400, "text": "2,400억원", "flag": None, "valid": True, "isBaseCase": False}, {"value": 2346, "text": "2,346억원", "flag": "base", "valid": True, "isBaseCase": True}], [{"value": 2595, "text": "2,595억원", "flag": None, "valid": True, "isBaseCase": False}, {"value": None, "text": None, "flag": "invalid", "valid": False, "isBaseCase": False}]]})},
        {"type": "chart", "id": "c5", "chart": chart("range", categories=["Overall"], range=[{"label": "Overall", "low": point("1,207억원", 1207), "base": point("2,146억원", 2146), "high": point("3,233억원", 3233)}, {"label": "Scenario", "low": point("1,207억원", 1207), "base": None, "high": point("3,233억원", 3233)}])},
        {"type": "chart", "id": "c6", "chart": chart("stacked-bar", series=[series("a", "A", [10, 20]), series("b", "B", [5, 7])])},
        {"type": "chart", "id": "c7", "chart": chart("bar", series=[series("a", "A", [-30, 20])])},
        {"type": "table", "id": "sens", "title": "민감도", "markers": ["S3"], "notices": ["Base case 는 Base 표시로 구분합니다."], "columns": [{"label": "g \\ WACC", "align": "left", "kindLabel": None}, {"label": "8.00%", "align": "right", "kindLabel": "Estimate"}, {"label": "8.14%", "align": "right", "kindLabel": "Estimate"}],
         "rows": [{"label": "2.00%", "kindLabel": "Calculated", "operator": None, "note": None, "emphasis": False, "cells": [cell("2,400억원", ["S3"]), cell("2,346억원", ["S3"], flag="base")]}]},
        {"type": "list", "title": "Model Review", "items": [{"text": "DCF 가치가 Terminal Value 에 크게 의존합니다.", "markers": ["S3"], "note": "참고 기준: 80% 초과"}]},
        {"type": "paragraph", "text": "보조 설명 문장. Base − 항목 → 값 × 배수", "markers": ["S3"], "muted": True},
        {"type": "heading", "id": "sec-sources", "level": 1, "number": "3", "text": "Sources", "status": "ok", "pageBreakBefore": True},
        {"type": "sources", "entries": [
            {"marker": "S1", "id": "src-historical", "label": "OpenDART 재무제표 (Database 저장본)", "type": "OpenDART", "kind": "historical", "asOf": "2026-10-07T00:00:00+00:00", "provider": "database", "reliability": None, "reference": "Consolidated", "url": None, "document": None, "providerInfo": None, "notice": None},
            {"marker": "S2", "id": "src-doc", "label": "사업보고서 (2025.12)", "type": "Disclosure", "kind": "disclosure", "asOf": "2026-03-10", "provider": "opendart", "reliability": None, "reference": "II. 사업의 내용 · 접수번호 20260310002820 · 공시일 2026-03-10", "url": None, "document": None, "providerInfo": None, "notice": None},
            {"marker": "S3", "id": "src-mkt", "label": "005930.KS market data", "type": "Market Data", "kind": "market", "asOf": "2026-10-07T03:00:00+00:00", "provider": "yahoo-finance", "reliability": "unofficial · development", "reference": None, "url": "https://example.com/q", "document": None, "providerInfo": None, "notice": "Development Source: 공식 · Valuation 등급 데이터가 아닙니다 (참고용)."},
        ]},
    ]
    meta = {"title": KO, "company": "삼성전자", "ticker": "005930", "createdAt": "2026-10-08T01:02:03Z", "valuationDate": "2026-10-08", "reportId": "rpt-test", "schemaVersion": "1.0", "templateId": "valuation-standard-v1", "templateVersion": "1.0", "currency": "KRW", "monetaryUnit": "억원", "language": "ko", "filename": "ValuFlow_삼성전자_Valuation_2026-10-08.pdf", "footer": f"{KO} · valuation-standard-v1 v1.0 · schema 1.0"}
    return {"version": "1.0", "meta": meta, "banners": [], "blocks": blocks + (blocks_extra or [])}


def text_of(pdf: bytes) -> list[str]:
    return [(p.extract_text() or "") for p in PdfReader(io.BytesIO(pdf)).pages]


@pytest.fixture(scope="module")
def pdf_bytes():
    data, info = render_pdf(sample_model())
    return data, info


def embedded(info) -> bool:
    return info["font"] == "ttf-embedded"


def test_pdf_is_a4_with_pages_metadata_and_outline(pdf_bytes):
    data, info = pdf_bytes
    r = PdfReader(io.BytesIO(data))
    assert data.startswith(b"%PDF") and len(r.pages) >= 2
    for p in r.pages:
        assert (round(float(p.mediabox.width)), round(float(p.mediabox.height))) == (595, 842), "A4"
    meta = r.metadata
    assert meta.title == KO and meta.author == "ValuFlow"
    assert "삼성전자 valuation report" in meta.subject and "2026-10-08" in meta.subject
    assert "rpt-test" in meta.keywords and "valuation-standard-v1 v1.0" in meta.keywords and "schema 1.0" in meta.keywords
    titles = [o.title for o in r.outline]
    assert any("Executive Summary" in t for t in titles) and any("Sources" in t for t in titles), "섹션 북마크"
    assert info["pages"] == str(len(r.pages))


def test_korean_text_is_not_broken(pdf_bytes):
    data, info = pdf_bytes
    if not embedded(info):
        pytest.skip("한글 TTF 폰트가 없는 환경 (CID 폴백)")
    pages = "\n".join(text_of(data))
    for s in ["삼성전자", "가정이 학습용 가상값입니다", "수익성 개선이 이어지고 있다", "필요한 입력 계정이 없다".replace("필요한 입력 계정이 없다", "—"), "사업보고서 (2025.12)", "접수번호 20260310002820", "억원", "조원"]:
        assert s in pages, s
    assert "?" not in re.sub(r"https?://\S+", "", pages), "글리프가 없어 ? 로 바뀐 문자가 없다 (− → × 는 대체 처리)"


def test_numbers_footnotes_banner_and_page_numbers(pdf_bytes):
    data, info = pdf_bytes
    pages = text_of(data)
    allt = "\n".join(pages)
    for s in ["2,346억원", "214,556원", "8.14%", "3,336,059억원", "333.61조원", "[S1]", "[S3]", "Page 1 /", f"Page {len(pages)} / {len(pages)}", "Learning / Demonstration Data"]:
        assert s in allt, s
    assert "Learning / Demonstration Data" in pages[0], "학습용 고지는 표지에 보인다"
    for i, t in enumerate(pages, start=1):
        assert f"Page {i} / {len(pages)}" in t, f"{i}쪽 번호"
        if i > 1:
            assert "삼성전자" in t or not embedded(info), "header"
    assert "FACT" in allt and "JUDGMENT" in allt and "Base" in allt
    assert "Development Source" in allt and "https://example.com/q" in allt


def test_tables_are_not_cut_and_charts_render_every_type(pdf_bytes):
    data, info = pdf_bytes
    allt = "\n".join(text_of(data))
    # 표의 모든 셀 문자열이 PDF 에 있다 (잘림 없음)
    for s in ["Revenue", "3,008,709억원", "Operating Margin", "13.07%", "2,400억원", "2,346억원", "KRW million"]:
        assert s in allt, s
    # 차트 직접 값 라벨 (워터폴 · 히트맵 · 범위)
    for s in ["Net Debt", "2,146억원", "Low 1,207억원", "High 3,233억원", "Base 2,146억원", "invalid"]:
        assert s in allt, s
    # 결측 값은 — 로 표시한다
    assert "—" in allt


def test_page_count_grows_with_content_and_long_table_splits_with_header():
    rows = [{"label": f"항목 {i}", "kindLabel": None, "operator": None, "note": None, "emphasis": False, "cells": [cell(f"{i * 1000:,}억원", ["S1"]), cell(f"{i}.00%")]} for i in range(1, 90)]
    big = {"type": "table", "id": "big", "title": "긴 표", "markers": [], "notices": [], "columns": [{"label": "항목", "align": "left", "kindLabel": None}, {"label": "값", "align": "right", "kindLabel": None}, {"label": "비율", "align": "right", "kindLabel": None}], "rows": rows}
    data, info = render_pdf(sample_model([big]))
    pages = text_of(data)
    assert len(pages) >= 4
    assert sum("항목 89" in p for p in pages) == 1 and sum("항목 1 " in p or "항목 1\n" in p for p in pages) >= 1
    if embedded(info):
        with_rows = [p for p in pages if "항목 " in p and "값" in p and "비율" in p]
        assert len(with_rows) >= 2, "표가 쪽을 넘겨도 머리글이 반복된다"


def test_empty_charts_and_missing_values_do_not_crash():
    c = [{"type": "chart", "id": "e1", "chart": chart("grouped-bar", series=[{"key": "a", "label": "A", "kind": "actual", "unit": "eok", "points": [point(None, None, "missing"), point(None, None, "unavailable")]}])},
         {"type": "chart", "id": "e2", "chart": chart("line", series=[{"key": "a", "label": "A", "kind": "actual", "unit": "ratio", "points": [point(None, None, "missing")]}])},
         {"type": "chart", "id": "e3", "chart": chart("waterfall", waterfall=[{"key": "a", "label": "A", "operator": None, "role": "start", "point": point(None, None, "missing")}])},
         {"type": "chart", "id": "e4", "chart": chart("range", range=[{"label": "x", "low": point(None, None, "missing"), "base": None, "high": point(None, None, "missing")}])}]
    data, _ = render_pdf(sample_model(c))
    assert data.startswith(b"%PDF")


def test_validation_rejects_bad_render_models():
    for bad in (None, {}, {"version": "2.0", "meta": {}, "blocks": []}, {"version": "1.0", "meta": {}, "blocks": [{"type": "script"}]}, {"version": "1.0", "meta": "x", "blocks": []}):
        with pytest.raises(ReportError):
            validate_render_model(bad)
    with pytest.raises(ReportError) as e:
        validate_render_model({"version": "1.0", "meta": {}, "blocks": [{"type": "paragraph"}] * 3001})
    assert e.value.code == "render-model-too-large" and e.value.status == 413


def test_xml_like_text_is_escaped_not_interpreted():
    evil = {"type": "paragraph", "text": "<b>굵게</b> & <script>x</script> <font color='red'>", "markers": [], "muted": False}
    data, info = render_pdf(sample_model([evil]))
    if embedded(info):
        assert "<script>x</script>" in "\n".join(text_of(data)), "태그는 해석되지 않고 문자 그대로 보인다"


def test_font_strategy_env_candidates_and_cid_fallback(monkeypatch):
    fs = fonts_mod.load_fonts(refresh=True)
    assert fs.kind in ("ttf-embedded", "cid-fallback")
    # 잘못된 env 경로는 건너뛰고 다음 후보를 쓴다
    monkeypatch.setenv("REPORT_FONT_REGULAR", "/no/such/font.ttf")
    assert fonts_mod.load_fonts(refresh=True).kind == fs.kind
    # 후보가 하나도 없으면 CID 폴백으로 PDF 는 만들어진다
    monkeypatch.setattr(fonts_mod, "CANDIDATES", [])
    fb = fonts_mod.load_fonts(refresh=True)
    assert fb.kind == "cid-fallback" and fb.glyphs is None
    data, info = render_pdf(sample_model())
    assert data.startswith(b"%PDF") and info["font"] == "cid-fallback"
    monkeypatch.undo()
    fonts_mod.load_fonts(refresh=True)
    # 폰트에 없는 기호는 대체된다 (사각형 대신)
    if fs.glyphs is not None:
        assert fonts_mod.fit("A−B→C", fs).replace("?", "") != "" and "−" not in fonts_mod.fit("A−B", fs) or 0x2212 in fs.glyphs


def test_no_font_files_or_network_in_report_package():
    pkg = Path(__file__).resolve().parents[1] / "app" / "report"
    assert not [p for p in pkg.rglob("*") if p.suffix.lower() in {".ttf", ".otf", ".ttc", ".woff", ".woff2"}], "폰트 파일을 저장소에 포함하지 않는다"
    src = "\n".join(p.read_text() for p in pkg.glob("*.py"))
    assert not re.search(r"\b(httpx|requests|urllib\.request|openai|socket)\b", src), "Report 렌더러는 네트워크 · LLM 을 호출하지 않는다"


def test_pdf_endpoint_returns_pdf_with_headers_and_sanitized_errors():
    client = TestClient(create_app())
    r = client.post("/api/report/pdf", json=sample_model())
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf" and r.content.startswith(b"%PDF")
    assert "attachment" in r.headers["content-disposition"] and "filename*=UTF-8''ValuFlow_%EC%82%BC%EC%84%B1%EC%A0%84%EC%9E%90_Valuation_2026-10-08.pdf" in r.headers["content-disposition"]
    assert re.search(r'filename="[\x20-\x7e]+\.pdf"', r.headers["content-disposition"]), "ASCII fallback 이름"
    assert r.headers["x-report-font"] in ("ttf-embedded", "cid-fallback") and int(r.headers["x-report-pages"]) >= 2
    assert r.headers["cache-control"] == "no-store"
    bad = client.post("/api/report/pdf", json={"version": "9", "meta": {}, "blocks": []})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "unsupported-render-model"
    assert client.post("/api/report/pdf", json={"version": "1.0", "meta": {}, "blocks": [{"type": "x"}]}).status_code == 422
    # 렌더링 중 예외는 내용을 노출하지 않고 pdf-render-failed
    broken = sample_model([{"type": "table", "id": "t", "title": "t", "markers": [], "notices": [], "columns": [], "rows": [{"label": "x"}]}])
    e = client.post("/api/report/pdf", json=broken)
    assert e.status_code == 500 and e.json()["error"] == {"code": "pdf-render-failed", "message": "PDF 를 만들지 못했습니다."}
