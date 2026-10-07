"""실제 외부 데이터 Tool smoke test (OPENAI_API_KEY + DART_API_KEY 가 있을 때만; Yahoo Finance · FRED · Google News 는 Key 가 필요 없다).
삼성전자로 시가총액 · WACC 근거 · 비교기업 · 뉴스 질문을 실제 LLM 으로 확인한다. 외부 provider 가 막히면(rate-limit 등) 그 Tool 의 결과를 보고 skip 한다.
frontend Tool(getForecastAssumptions · getValuationResult)은 TS 런타임이라 값이 고정된 stub 결과를 쓴다."""
import pytest

from app.ai.external_tools import ExternalProviders, TickerInfo, make_external_tools
from app.ai.gateway import AiGateway
from app.ai.provider import OpenAiProvider
from app.ai.state import derive_secret
from app.config import load_settings
from app.dart.client import DartHttpClient
from app.dart.corp_codes import CorpCodeCache
from app.external.fred import FredRiskFree
from app.external.news import GoogleNews
from app.external.yahoo import YahooComparables, YahooMarketData

settings = load_settings()
pytestmark = pytest.mark.skipif(not (settings.has_api_key and settings.has_ai), reason="DART_API_KEY / OPENAI_API_KEY 가 없어 실제 외부 데이터 smoke test 를 건너뜁니다.")

SAMSUNG = "00126380"
CTX = {"company": {"corpCode": SAMSUNG, "name": "삼성전자", "stockCode": "005930"}, "support": {"status": "supported"}, "dataKinds": {"historical": "actual", "assumptions": "user", "results": "calculated"},
       "periods": ["2023A", "2024A", "2025A"], "availability": {"historical": True}}
STUBS = {"getForecastAssumptions": {"valuationAssumptions": {"wacc": 0.081, "terminalGrowth": 0.02}, "basis": "user input"},
         "getValuationResult": {"enterpriseValueEok": 5_000_000, "wacc": 0.081}, "getRelativeValuation": {"note": "stub"}, "getHistoricalAnalysis": {"note": "stub"}}


@pytest.fixture(scope="module")
def gateway():
    cache = CorpCodeCache(DartHttpClient(settings).fetch_corp_code_zip)

    def resolver(code):
        rec = next((r for r in cache.get() if r.corp_code == code), None)
        return TickerInfo(rec.corp_name, (rec.stock_code or "").strip() or None) if rec else None
    market = YahooMarketData()
    tools = make_external_tools(ExternalProviders(market, FredRiskFree(), YahooComparables(market), GoogleNews()), resolver)
    return AiGateway(OpenAiProvider(settings.openai_api_key, settings.openai_model, settings.openai_base_url), derive_secret(settings.ai_state_secret, settings.openai_api_key), backend_tools=tools)


def drive(gw, question):
    resp = gw.query(question, CTX)
    frontend = []
    for _ in range(8):
        if resp["status"] != "tool-call":
            break
        frontend.append(resp["tool"])
        data = STUBS.get(resp["tool"], {"note": "stub"})
        resp = gw.tool_result(resp["state"], resp["callId"], {"status": "ok", "tool": resp["tool"], "data": data, "sources": [], "warnings": []}, resp["conversationId"])
    return frontend, resp


def tool_ok(resp, name):
    res = [r for r in resp["backendToolResults"] if r["tool"] == name]
    assert res, (name, [t["tool"] for t in resp["toolTrace"]])
    if res[0]["status"] in ("rate-limit", "unavailable"):
        pytest.skip(f"{name}: provider {res[0]['status']} ({res[0].get('reason')})")
    assert res[0]["status"] == "ok", res[0]
    return res[0]


def test_market_cap_question_uses_get_market_data_with_asof_and_source(gateway):
    _, resp = drive(gateway, "현재 삼성전자 시가총액을 알려줘.")
    assert resp["status"] == "final", resp
    r = tool_ok(resp, "getMarketData")
    assert r["data"]["marketCap"]["value"] > 0 and r["data"]["asOf"] and r["data"]["marketCap"]["source"]
    ms = [s for s in resp["answer"]["sources"] if s["type"] == "market-data"]
    assert ms and ms[0]["asOf"] and ms[0]["origin"] == "yahoo-finance", resp["answer"]["sources"]


def test_wacc_review_uses_valuflow_assumptions_and_market_assumptions_without_applying(gateway):
    frontend, resp = drive(gateway, "삼성전자 WACC 가정을 검토해줘.")
    assert resp["status"] == "final", resp
    assert "getForecastAssumptions" in frontend or "getValuationResult" in frontend, frontend
    r = tool_ok(resp, "getMarketAssumptions")
    assert r["data"]["applied"] is False and r["data"]["riskFreeRate"].get("maturity") == "10Y" and r["data"]["marketRiskPremium"]["status"] == "missing"
    assert any(s["type"] == "market-data" and s["asOf"] for s in resp["answer"]["sources"])


def test_comparable_question_uses_get_comparable_companies(gateway):
    _, resp = drive(gateway, "비교기업과 valuation을 비교해줘.")
    assert resp["status"] == "final", resp
    r = tool_ok(resp, "getComparableCompanies")
    names = {p["ticker"] for p in r["data"]["peers"]}
    assert names and r["data"]["applied"] is False and all(p["selectionReasons"] and p["asOf"] for p in r["data"]["peers"])
    assert all(set(p["multiples"]) == {"per", "pbr", "evEbitda"} for p in r["data"]["peers"])


def test_news_question_uses_search_company_news_with_dates(gateway):
    _, resp = drive(gateway, "최근 주요 뉴스가 valuation에 미칠 수 있는 영향을 정리해줘.")
    assert resp["status"] == "final", resp
    r = tool_ok(resp, "searchCompanyNews")
    assert r["data"]["results"] and all(i["publishedAt"] and i["url"] for i in r["data"]["results"])
    ns = [s for s in resp["answer"]["sources"] if s["type"] == "news"]
    assert ns and ns[0]["publishedAt"] and ns[0]["url"] and ns[0]["publisher"] is not None
