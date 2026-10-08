"""D&A 사업보고서 주석 fallback: OpenDART 재무제표 계정에 D&A 가 없을 때만 주석에서 읽고, 없으면 source unavailable 로 둔다 (추정 · 0 · fixture 없음)."""
from __future__ import annotations

from datetime import date

from app.dart.corp_codes import CorpCodeCache
from app.dart.da_notes import AnnualReportNoteSource, extract_da_notes, pick_annual_report
from app.dart.documents import parse_document_xml
from app.dart.filings import Filing
from app.dart.financials import FinancialsService
from app.dart.models import DartApiError, FinancialAccount
from app.services.historical import HistoricalService
from tests.test_disclosure_rag import doc_xml

CORP = "00126380"


def table(rows):
    return "<TABLE><TBODY>" + "".join("<TR>" + "".join(f"<TD>{c}</TD>" for c in r) + "</TR>" for r in rows) + "</TBODY></TABLE>"


def period(label, unit="백만원"):
    return table([[label, f"(단위 : {unit})"]])


def nature(depr, amort):
    return table([["공시금액"], ["성격별 비용", "290,004,888"], ["원재료 등의 사용액 및 상품 매입액 등", "102,992,621"], ["급여", "37,094,712"],
                  ["감가상각비", depr], ["무형자산상각비", amort], ["기타 비용", "61,591,905"]])


def adjustments(depr, amort):
    return table([["공시금액"], ["조정내역 계", "52,395,616"], ["조정내역 계", "법인세비용", "4,274,666"], ["퇴직급여", "1,798,189"], ["감가상각비", depr], ["무형자산상각비", amort]])


def notes_section(title, tables):
    return f'<SECTION-1><TITLE ATOC="Y">III. 재무에 관한 사항</TITLE><SECTION-2><TITLE ATOC="Y">{title}</TITLE>{"".join(tables)}</SECTION-2></SECTION-1>'


# 2025 사업보고서: 연결(조정내역 + 성격별 분류, 당기/전기) 와 별도 (성격별 분류만, 값이 다르다)
REPORT_2025 = doc_xml([
    notes_section("34. 보고기간후사건 (연결)", [
        period("당기"), nature("43,605,740", "3,320,852"), period("전기"), nature("39,649,982", "2,980,840"),
        period("당기"), adjustments("43,605,740", "3,320,852"), period("전기"), adjustments("39,649,982", "2,980,840"),
    ]),
    notes_section("32. 보고기간후사건", [period("당기"), nature("35,291,428", "2,757,986"), period("전기"), nature("30,200,000", "2,500,000")]),
])
# 2024 사업보고서: 헤더 블록은 있지만 제목 문구가 없고 성격별 분류만 있다 (제목 문구에 의존하지 않는다)
REPORT_2024 = doc_xml([notes_section("33. 매각예정분류 (연결)", [period("당기"), nature("39,649,982", "2,980,840"), period("전기"), nature("35,532,411", "3,134,148")])])
NO_DA = doc_xml([notes_section("34. 보고기간후사건 (연결)", [period("당기"), table([["공시금액"], ["성격별 비용", "1"], ["원재료 등의 사용액 및 상품 매입액 등", "1"], ["급여", "2"]])])])


def filing(rcept, name, year, filed, corr=False, rtype="annual"):
    return Filing(rcept, CORP, "삼성전자", name, rtype, filed, year, corr)


def acct(name, year, amount, sj="CF", acc_id=None, basis="Consolidated"):
    return FinancialAccount(account_name=name, account_id=acc_id, statement_type=sj, raw_statement_type=sj, basis=basis, fiscal_year=year, report_year=2025, amount=amount, currency="KRW", raw={})


class FakeFilings:
    def __init__(self, filings, docs):
        self.filings, self.docs, self.fetched = filings, docs, []

    def list_filings(self, corp_code, bgn_de, end_de):
        return [f for f in self.filings if bgn_de <= f.filing_date.strftime("%Y%m%d") <= end_de]

    def fetch_document(self, receipt_no):
        self.fetched.append(receipt_no)
        if receipt_no not in self.docs:
            raise DartApiError("dart-unavailable")
        return self.docs[receipt_no]


FILINGS = [filing("R2025", "사업보고서 (2025.12)", 2025, date(2026, 3, 10)), filing("R2024", "사업보고서 (2024.12)", 2024, date(2025, 3, 11)),
           filing("Q2026", "분기보고서 (2026.03)", 2026, date(2026, 5, 15), rtype="quarterly"), filing("H2025", "반기보고서 (2025.06)", 2025, date(2025, 8, 14), rtype="half")]
DOCS = {"R2025": REPORT_2025, "R2024": REPORT_2024}


def test_extracts_consolidated_and_separate_values_in_krw_from_structure():
    notes = extract_da_notes(parse_document_xml(REPORT_2025))
    cf = {(n.basis, n.period): n for n in notes if n.source_type == "cash-flow-adjustment"}
    assert cf[("Consolidated", "당기")].values == {"depreciation": 43_605_740 * 1_000_000, "amortization": 3_320_852 * 1_000_000}
    assert cf[("Consolidated", "전기")].values["depreciation"] == 39_649_982 * 1_000_000
    assert not any(k[0] == "Separate" for k in cf), "별도 보고서에는 조정내역 표가 없다"
    nat = {(n.basis, n.period): n for n in notes if n.source_type == "annual-report-note"}
    assert nat[("Separate", "당기")].values["depreciation"] == 35_291_428 * 1_000_000, "연결/별도는 섞이지 않는다"
    assert nat[("Consolidated", "당기")].values["amortization"] == 3_320_852 * 1_000_000


def test_unit_is_converted_and_unknown_units_are_skipped():
    xml = doc_xml([notes_section("1. 주석 (연결)", [period("당기", "천원"), nature("5,000", "700")])])
    assert extract_da_notes(parse_document_xml(xml))[0].values["depreciation"] == 5_000_000
    xml = doc_xml([notes_section("1. 주석 (연결)", [period("당기", "달러"), nature("5,000", "700")])])
    assert extract_da_notes(parse_document_xml(xml)) == []


def test_pick_annual_report_uses_latest_filing_including_corrections_and_never_quarterly_or_half():
    fs = [*FILINGS, filing("R2025C", "[기재정정]사업보고서 (2025.12)", 2025, date(2026, 4, 2), corr=True)]
    assert pick_annual_report(fs, CORP, 2025).receipt_no == "R2025C"
    assert pick_annual_report(FILINGS, CORP, 2025).receipt_no == "R2025"
    assert pick_annual_report(FILINGS, CORP, 2026) is None, "분기보고서(2026.03)는 사업보고서가 아니다"
    assert pick_annual_report(FILINGS, "99999999", 2025) is None


def test_enrich_fills_only_years_without_da_accounts_with_provenance():
    src = FakeFilings(FILINGS, DOCS)
    rows, warnings = AnnualReportNoteSource(src).enrich(CORP, [acct("감가상각비", 2023, 1)], [2023, 2024, 2025], "Consolidated")
    got = {(r.fiscal_year, r.account_name): r.amount for r in rows}
    assert got[(2025, "감가상각비")] == 43_605_740 * 1_000_000 and got[(2025, "무형자산상각비")] == 3_320_852 * 1_000_000
    assert got[(2024, "감가상각비")] == 39_649_982 * 1_000_000
    assert not any(y == 2023 for y, _ in got), "이미 재무제표에 D&A 가 있는 연도는 건드리지 않는다"
    r = next(r for r in rows if r.fiscal_year == 2025)
    assert r.raw["sourceType"] == "cash-flow-adjustment" and r.raw["receiptNo"] == "R2025" and r.raw_statement_type == "NOTE" and r.statement_type == "CF"
    assert "R2024" not in src.fetched, "R2025 문서가 2025 · 2024 를 모두 덮는다"
    assert any("taken from annual report notes" in w for w in warnings)


def test_falls_back_to_nature_of_expense_when_adjustments_are_absent():
    src = FakeFilings(FILINGS, DOCS)
    rows, _ = AnnualReportNoteSource(src).enrich(CORP, [], [2023], "Consolidated")   # 2023 은 R2024 의 전기 열이 아니라 2023 보고서가 없으므로 없다
    assert rows == []
    rows, _ = AnnualReportNoteSource(src).enrich(CORP, [], [2024], "Consolidated")
    assert {r.account_name for r in rows} == {"감가상각비", "무형자산상각비"} and all(r.raw["sourceType"] in ("cash-flow-adjustment", "annual-report-note") for r in rows)
    rows, _ = AnnualReportNoteSource(FakeFilings(FILINGS, {"R2025": REPORT_2025, "R2024": REPORT_2024})).enrich(CORP, [], [2024], "Consolidated")
    only_nature = doc_xml([notes_section("33. 주석 (연결)", [period("당기"), nature("1,000", "200")])])
    rows, _ = AnnualReportNoteSource(FakeFilings([filing("R2025", "사업보고서 (2025.12)", 2025, date(2026, 3, 10))], {"R2025": only_nature})).enrich(CORP, [], [2025], "Consolidated")
    assert {r.raw["sourceType"] for r in rows} == {"annual-report-note"}


def test_source_unavailable_is_kept_without_estimating():
    # 주석에 D&A 행이 없다 / 사업보고서가 목록에 없다 / 문서를 못 받는다 → 행을 만들지 않고 이유만 남긴다
    for filings, docs, text in [([filing("R2025", "사업보고서 (2025.12)", 2025, date(2026, 3, 10))], {"R2025": NO_DA}, "no depreciation/amortization row"),
                                ([], {}, "no annual report found"),
                                ([filing("R2025", "사업보고서 (2025.12)", 2025, date(2026, 3, 10))], {}, "could not be read")]:
        rows, warnings = AnnualReportNoteSource(FakeFilings(filings, docs)).enrich(CORP, [], [2025], "Consolidated")
        assert rows == [], "0 · 추정값 · fixture 로 채우지 않는다"
        assert any(text in w for w in warnings), warnings


def test_historical_service_exposes_note_da_with_trace_and_keeps_missing_when_unavailable():
    fin_rows = [{"sj_div": "IS", "account_id": "ifrs-full_Revenue", "account_nm": "매출액", "thstrm_amount": "300", "frmtrm_amount": "200", "bfefrmtrm_amount": "100", "account_detail": "-"}]
    svc_fin = FinancialsService(lambda *a: fin_rows)
    cache = CorpCodeCache(lambda: b"")
    cache._records = []   # noqa: SLF001  (이 테스트는 corp 목록을 쓰지 않는다)
    svc = HistoricalService(svc_fin, cache, None, notes=AnnualReportNoteSource(FakeFilings(FILINGS, DOCS)))
    accounts, q, *_ = svc_fin.collect(CORP, [2024, 2025])
    q_warn_before = list(q.warnings)
    out = svc._with_note_da(CORP, accounts, [2024, 2025], q)   # noqa: SLF001
    assert len(out) > len(accounts) and q.raw_account_count == len(out) and len(q.warnings) > len(q_warn_before)
    none = HistoricalService(svc_fin, cache, None, notes=None)
    assert none._with_note_da(CORP, accounts, [2024, 2025], q) == accounts   # noqa: SLF001


class StoreWithOldResult:
    """fallback 도입 전에 저장된 결과(D&A missing, 주석 시도 흔적 없음)를 돌려주는 최소 store."""

    def __init__(self, warnings):
        self.hit = {"result": {"ok": True, "quality": {"fields": {"depreciationAmortization": {"status": "missing"}}, "warnings": warnings}, "data": {}}, "fetch": {"warnings": []},
                    "fetchedAt": "2026-10-08T01:30:30+00:00", "fetchId": 1}

    def find_current(self, key):
        return self.hit


def test_stored_result_without_da_is_refetched_once_but_unavailable_is_respected():
    svc = HistoricalService(FinancialsService(lambda *a: []), CorpCodeCache(lambda: b""), StoreWithOldResult([]), notes=AnnualReportNoteSource(FakeFilings(FILINGS, DOCS)))  # type: ignore[arg-type]
    assert svc._stale_without_note_da(svc._store.hit) is True                      # noqa: SLF001  (예전 저장본: 다시 수집한다)
    old = StoreWithOldResult(["D&A source unavailable for 2025: annual report R2025 notes have no depreciation/amortization row (Consolidated)"])
    assert svc._stale_without_note_da(old.hit) is False                            # noqa: SLF001  (이미 시도했고 원본에 없다: 그대로 쓴다)
    with_value = StoreWithOldResult([]); with_value.hit["result"]["quality"]["fields"]["depreciationAmortization"]["status"] = "available"
    assert svc._stale_without_note_da(with_value.hit) is False                     # noqa: SLF001
    assert HistoricalService(FinancialsService(lambda *a: []), CorpCodeCache(lambda: b""), None)._stale_without_note_da(svc._store.hit) is False   # noqa: SLF001  (fallback 없으면 그대로)


def test_note_titles_inside_table_groups_become_their_own_sections_without_losing_text():
    """주석은 <TABLE-GROUP><TITLE>…</TITLE> 로 오는데, 예전 파서는 이 제목을 상위 섹션 제목에 계속 덮어써서 모든 주석이 마지막 제목으로 인용됐다."""
    body = ('<SECTION-1><TITLE ATOC="Y">III. 재무에 관한 사항</TITLE><SECTION-2><TITLE ATOC="Y">3. 연결재무제표 주석</TITLE>'
            '<TABLE-GROUP><TITLE ATOC="Y">21. 비용의 성격별 분류 (연결)</TITLE>' + period("당기") + nature("43,605,740", "3,320,852") + '</TABLE-GROUP>'
            '<TABLE-GROUP><TITLE ATOC="Y">34. 보고기간후사건 (연결)</TITLE><P>보고기간 이후 사건 없음</P></TABLE-GROUP></SECTION-2></SECTION-1>')
    parsed = parse_document_xml(doc_xml([body]))
    paths = [" > ".join(s.path) for s in parsed.sections]
    assert "III. 재무에 관한 사항 > 3. 연결재무제표 주석 > 21. 비용의 성격별 분류 (연결)" in paths
    assert "III. 재무에 관한 사항 > 3. 연결재무제표 주석 > 34. 보고기간후사건 (연결)" in paths
    nat = next(s for s in parsed.sections if "21." in s.path[-1])
    assert any("감가상각비" in b.text for b in nat.blocks), "표는 자기 제목 아래에 있다 (마지막 제목으로 라벨링되지 않는다)"
    assert extract_da_notes(parsed)[0].section.endswith("21. 비용의 성격별 분류 (연결)")
