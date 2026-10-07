import httpx
import pytest

from app.config import Settings
from app.dart.client import DartHttpClient
from app.dart.financials import FinancialsService, parse_amount, parse_financial_rows, plan_report_years
from app.dart.models import DartApiError
from tests.conftest import SECRET, row, sample_rows

CORP = "00126380"


def fin_requests(fake):
    return [r for r in fake.requests if r.url.path.endswith("fnlttSinglAcntAll.json")]


def test_financial_request_parameters(client, fake):  # 1, 2
    r = client.get(f"/api/companies/{CORP}/financials", params={"years": "2023,2024,2025"})
    assert r.status_code == 200
    reqs = fin_requests(fake)
    assert len(reqs) == 1, "사업보고서 한 건(2025)이 2023~2025 를 모두 담는다"
    p = reqs[0].url.params
    assert (p["corp_code"], p["bsns_year"], p["reprt_code"], p["fs_div"]) == (CORP, "2025", "11011", "CFS")
    assert p["crtfc_key"] == SECRET  # Key 는 서버가 붙인다
    q = r.json()["quality"]
    assert (q["basisRequested"], q["basisUsed"], q["basisFallback"]) == ("Consolidated", "Consolidated", False)


def test_ofs_fallback_when_consolidated_unavailable(client, fake):  # 3
    def only_separate(request):
        if request.url.params["fs_div"] == "OFS":
            return httpx.Response(200, json={"status": "000", "list": sample_rows(int(request.url.params["bsns_year"]))})
        return httpx.Response(200, json={"status": "013"})

    fake.financials_response = only_separate
    body = client.get(f"/api/companies/{CORP}/financials", params={"years": "2023,2024,2025"}).json()
    assert [r.url.params["fs_div"] for r in fin_requests(fake)] == ["CFS", "OFS"]
    q = body["quality"]
    assert (q["basisUsed"], q["basisFallback"]) == ("Separate", True)
    assert {a["basis"] for a in body["accounts"]} == {"Separate"}
    assert any(w.startswith("Separate statements used because consolidated data unavailable") for w in q["warnings"])


def test_incomplete_consolidated_switches_whole_dataset_never_mixes(client, fake):
    def incomplete_cfs(request):
        rows = sample_rows(int(request.url.params["bsns_year"]))
        if request.url.params["fs_div"] == "CFS":
            rows = [r for r in rows if r["sj_div"] != "CF"]  # 연결에 현금흐름표가 없다
        return httpx.Response(200, json={"status": "000", "list": rows})

    fake.financials_response = incomplete_cfs
    body = client.get(f"/api/companies/{CORP}/financials", params={"years": "2025"}).json()
    assert {a["basis"] for a in body["accounts"]} == {"Separate"}  # 연결 일부 + 별도 일부 혼합 금지
    assert body["quality"]["basisFallback"] is True
    assert any("also fetched but not used" in w for w in body["quality"]["warnings"])


def test_explicit_basis_modes(client, fake):
    client.get(f"/api/companies/{CORP}/financials", params={"years": "2025", "basis": "separate"})
    assert [r.url.params["fs_div"] for r in fin_requests(fake)] == ["OFS"]
    assert client.get(f"/api/companies/{CORP}/financials", params={"years": "2025", "basis": "consolidated"}).status_code == 200
    assert client.get(f"/api/companies/{CORP}/financials", params={"years": "2025", "basis": "weird"}).json()["error"]["code"] == "invalid-request"


@pytest.mark.parametrize("text,expected", [
    ("1,234,567", (1234567, True)), ("-123", (-123, True)), ("(1,000)", (-1000, True)), ("12.50", (12.5, True)), ("7.0", (7, True)),
    ("333,605,938,000,000", (333605938000000, True)), ("", (None, True)), ("  ", (None, True)), ("-", (None, True)), (None, (None, True)),
    ("abc", (None, False)), ("1,2x4", (None, False)), ("--5", (None, False)), (True, (None, False)),
])
def test_amount_parsing(text, expected):  # 4
    assert parse_amount(text) == expected


def test_blank_amount_is_not_zero():  # 5
    rows = [row("BS", "재고자산", ("", "-", None), "ifrs-full_Inventories")]
    accounts, warnings = parse_financial_rows(rows, "Consolidated", 2025)
    assert [a.amount for a in accounts] == [None, None, None]
    assert warnings == []
    accounts, warnings = parse_financial_rows([row("BS", "재고자산", ("12x", "1", "2"))], "Consolidated", 2025)
    assert accounts[0].amount is None and "Unparseable amount for 재고자산" in warnings[0]


def test_statement_type_mapping_preserves_raw_type():  # 6
    rows = sample_rows() + [row("SCE", "자본변동", ("1", "2", "3"))]
    accounts, _ = parse_financial_rows(rows, "Consolidated", 2025)
    by_name = {a.account_name: a for a in accounts}
    assert by_name["자산총계"].statement_type == "BS"
    assert by_name["매출액"].statement_type == "IS" and by_name["매출액"].raw_statement_type == "IS"
    assert by_name["당기순이익"].statement_type == "IS" and by_name["당기순이익"].raw_statement_type == "CIS"  # CIS → IS, 원본 보존
    assert by_name["영업활동현금흐름"].statement_type == "CF"
    assert "자본변동" not in by_name  # SCE 는 수집하지 않는다


def test_year_parsing_three_periods():  # 7
    accounts, _ = parse_financial_rows([row("IS", "매출액", ("30", "20", "10"), "ifrs-full_Revenue")], "Consolidated", 2025)
    assert sorted((a.fiscal_year, a.amount) for a in accounts) == [(2023, 10), (2024, 20), (2025, 30)]
    assert all(a.report_year == 2025 for a in accounts)
    assert plan_report_years([2023, 2024, 2025]) == [2025]
    assert plan_report_years([2025]) == [2025]
    assert plan_report_years([2019, 2025]) == [2025, 2019]
    assert plan_report_years([2020, 2021, 2022, 2023, 2024, 2025]) == [2025, 2022]


def test_duplicate_prevention_within_response_and_across_reports():  # 8
    dup = [row("IS", "매출액", ("30", "20", "10"), "ifrs-full_Revenue"), row("IS", "매출액", ("30", "20", "10"), "ifrs-full_Revenue"),
           row("IS", "매출액", ("99", "20", "10"), "ifrs-full_Revenue")]
    accounts, warnings = parse_financial_rows(dup, "Consolidated", 2025)
    assert len(accounts) == 3  # 연도별 하나씩, 중복 행은 만들지 않는다
    assert [a.amount for a in accounts if a.fiscal_year == 2025] == [30]  # 첫 값 유지
    assert any("Duplicate account with different amount" in w for w in warnings)

    # 서로 다른 두 보고서(2025, 2022)가 겹치는 연도 없이 6개 연도를 덮고, 겹치면 최신 보고서가 대표다
    def fetch(corp, year, code, fs):
        return [row("IS", "매출액", (str(year * 10), str((year - 1) * 10), str((year - 2) * 10 + (1 if year == 2024 else 0))), "ifrs-full_Revenue", year),
                row("BS", "자산총계", ("1", "1", "1"), "ifrs-full_Assets", year), row("CF", "영업활동현금흐름", ("1", "1", "1"), "x", year)]

    accounts, quality, *_ = FinancialsService(fetch).collect(CORP, [2022, 2023, 2024, 2025])
    revenue = {a.fiscal_year: a.amount for a in accounts if a.account_name == "매출액"}
    assert set(revenue) >= {2022, 2023, 2024, 2025}
    assert revenue[2023] == 20230 and revenue[2022] == 20220  # 2023 은 2025 보고서, 2022 는 2022 보고서
    assert all(len([a for a in accounts if a.account_name == "매출액" and a.fiscal_year == y]) == 1 for y in revenue)  # 연도별 하나
    assert quality.missing_years == []


def test_api_error_mapping(client, fake):  # 9
    for status, code, http in (("010", "invalid-key", 502), ("020", "rate-limit", 429), ("100", "invalid-request", 400), ("800", "dart-unavailable", 503), ("999", "unknown", 502)):
        fake.financials_response = lambda r, s=status: httpx.Response(200, json={"status": s, "message": f"원문 {SECRET}"})
        r = client.get(f"/api/companies/{CORP}/financials", params={"years": "2025", "refresh": "true"})
        assert (r.status_code, r.json()["error"]["code"]) == (http, code)
        assert SECRET not in r.text and "원문" not in r.text
    fake.financials_response = lambda r: httpx.Response(200, content=b"<html>")
    assert client.get(f"/api/companies/{CORP}/financials", params={"years": "2025", "refresh": "true"}).json()["error"]["code"] == "unknown"
    fake.financials_response = lambda r: (_ for _ in ()).throw(httpx.ConnectError(f"boom {SECRET}"))
    r = client.get(f"/api/companies/{CORP}/financials", params={"years": "2025", "refresh": "true"})
    assert r.status_code == 503 and SECRET not in r.text


def test_request_validation(client):
    for params in ({}, {"years": "abc"}, {"years": ""}, {"years": "2010"}, {"years": "2030"}, {"years": "2019,2020,2021,2022,2023,2024"}):
        assert client.get(f"/api/companies/{CORP}/financials", params=params).json()["error"]["code"] == "invalid-request", params
    assert client.get("/api/companies/abc/financials", params={"years": "2025"}).json()["error"]["code"] == "invalid-request"


def test_no_data_handling(client, fake):  # 10
    fake.financials_response = lambda r: httpx.Response(200, json={"status": "013", "message": "no"})
    r = client.get(f"/api/companies/{CORP}/financials", params={"years": "2025"})
    assert r.status_code == 404 and r.json()["error"]["code"] == "no-data"
    fake.financials_response = lambda r: httpx.Response(200, json={"status": "000", "list": []})
    assert client.get(f"/api/companies/{CORP}/financials", params={"years": "2025", "refresh": "true"}).status_code == 404


def test_cache_reuse_and_refresh(client, fake):  # 11
    p = {"years": "2023,2024,2025"}
    a = client.get(f"/api/companies/{CORP}/financials", params=p).json()
    b = client.get(f"/api/companies/{CORP}/financials", params=p).json()
    assert len(fin_requests(fake)) == 1 and a["cached"] is False and b["cached"] is True
    assert a["accounts"] == b["accounts"]
    client.get(f"/api/companies/{CORP}/financials", params={**p, "refresh": "true"})
    assert len(fin_requests(fake)) == 2
    client.get(f"/api/companies/{CORP}/financials", params={"years": "2025", "basis": "separate"})  # 다른 basis 는 다른 cache 키
    assert len(fin_requests(fake)) == 3


def test_errors_are_not_cached(client, fake):
    fake.financials_response = lambda r: httpx.Response(200, json={"status": "020"})
    assert client.get(f"/api/companies/{CORP}/financials", params={"years": "2025"}).status_code == 429
    fake.financials_response = lambda r: httpx.Response(200, json={"status": "000", "list": sample_rows()})
    assert client.get(f"/api/companies/{CORP}/financials", params={"years": "2025"}).status_code == 200


def test_raw_row_preservation(client):  # 12
    body = client.get(f"/api/companies/{CORP}/financials", params={"years": "2025"}).json()
    rev = next(a for a in body["accounts"] if a["accountName"] == "매출액" and a["fiscalYear"] == 2025)
    assert rev["raw"]["thstrm_amount"] == "333,605,938,000,000"  # 문자열 원본 그대로
    assert rev["amount"] == 333605938000000 and rev["unit"] == "KRW" and rev["currency"] == "KRW"
    assert rev["raw"]["sj_div"] == "IS" and rev["raw"]["account_id"] == "ifrs-full_Revenue"
    cis = next(a for a in body["accounts"] if a["accountName"] == "당기순이익")
    assert (cis["statementType"], cis["rawStatementType"], cis["raw"]["sj_div"]) == ("IS", "CIS", "CIS")


def test_quality_fields_and_missing_years(client, fake):
    fake.financials_response = lambda r: httpx.Response(200, json={"status": "000", "list": [
        row("BS", "자산총계", ("1", "2", "3"), "ifrs-full_Assets"), row("IS", "매출액", ("1", "2", None), "ifrs-full_Revenue"), row("CF", "영업활동현금흐름", ("1", "2", "3"), "c")]})
    q = client.get(f"/api/companies/{CORP}/financials", params={"years": "2023,2024,2025", "basis": "consolidated"}).json()["quality"]
    assert q["yearsRequested"] == [2023, 2024, 2025]
    assert q["yearsReceived"] == [2023, 2024, 2025] and q["missingYears"] == []
    assert q["rawAccountCount"] == 9 and q["basisUsed"] == "Consolidated"
    assert "Statements are incomplete for the requested years" in q["warnings"]
    assert "Missing IS data for 2023" in q["warnings"] and "Missing BS data for 2023" not in q["warnings"]
    fake.financials_response = lambda r: httpx.Response(200, json={"status": "000", "list": [row("BS", "자산총계", ("1", "2", None), "a"), row("IS", "매출액", ("1", "2", None), "b"), row("CF", "영업활동현금흐름", ("1", "2", None), "c")]})
    q2 = client.get(f"/api/companies/{CORP}/financials", params={"years": "2023,2024,2025", "refresh": "true", "basis": "consolidated"}).json()["quality"]
    assert q2["yearsReceived"] == [2024, 2025] and q2["missingYears"] == [2023]


def test_missing_key_does_not_call_dart(make_client, fake):
    r = make_client(api_key="").get(f"/api/companies/{CORP}/financials", params={"years": "2025"})
    assert r.json()["error"]["code"] == "invalid-key" and not fake.requests


def test_key_never_in_financial_responses(client, fake):
    r = client.get(f"/api/companies/{CORP}/financials", params={"years": "2023,2024,2025"})
    assert SECRET not in r.text and "crtfc_key" not in r.text
