"""External Provider Credential Policy 테스트: credential 은 backend 설정에만, provider 별 Key 가 없으면 해당 Tool 만 unavailable, 응답 · 로그 · Audit 에 Key 없음.
모든 provider 는 mock 이고 실제 Key 에 의존하지 않는다."""
import io
import json
import logging
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.ai.external_tools import ExternalProviders, TickerInfo, make_external_tools
from app.ai.gateway import AiGateway
from app.ai.state import derive_secret
from app.config import Settings, load_settings
from app.external.errors import ProviderError
from app.external.registry import COMPARABLE_PROVIDERS, MARKET_PROVIDERS, NEWS_PROVIDERS, ProviderSpec, UnavailableProvider, build_external
from app.main import create_app
from app.secrets import MASK, RedactingFilter
from tests.test_ai_gateway import MockProvider, final, ok_result, tool_call
from tests.test_external_tools import no_network  # noqa: F401  (autouse: 네트워크 차단)
from tests.test_external_tools import NEWS, PEERS, SAMSUNG, FakeComps, FakeMarket, FakeNews, FakeRates, resolver, snap

MKEY, NKEY, RKEY, OKEY, DKEY = "mk-SECRET-1111111", "nk-SECRET-2222222", "rk-SECRET-3333333", "sk-SECRET-4444444", "dart-SECRET-5555555"
CTX = {"company": {"corpCode": SAMSUNG, "name": "삼성전자"}, "support": {"status": "supported"}}
ALL_KEYS = (MKEY, NKEY, RKEY, OKEY, DKEY)


def settings(**kw):
    return Settings(dart_api_key=DKEY, openai_api_key=OKEY, market_data_api_key=kw.pop("market_data_api_key", ""), news_api_key=kw.pop("news_api_key", ""), reranker_api_key=kw.pop("reranker_api_key", ""), **kw)


@pytest.fixture
def paid(monkeypatch):
    """Key 가 필요한 가짜 provider 를 registry 에 등록한다 (실제 vendor 없이 정책만 검증)."""
    built = []

    class PaidMarket(FakeMarket):
        name = "PaidMarket"

        def __init__(self, key):
            super().__init__()
            built.append(("market", key))

    class PaidNews(FakeNews):
        name = "PaidNews"

        def __init__(self, key):
            super().__init__(NEWS)
            built.append(("news", key))
    monkeypatch.setitem(MARKET_PROVIDERS, "paid", ProviderSpec("paid", True, lambda s, m: PaidMarket(s.market_data_api_key)))
    monkeypatch.setitem(COMPARABLE_PROVIDERS, "paid", ProviderSpec("paid", True, lambda s, m: FakeComps(PEERS)))
    monkeypatch.setitem(NEWS_PROVIDERS, "paid", ProviderSpec("paid", True, lambda s, m: PaidNews(s.news_api_key)))
    return built


def test_credentials_come_only_from_backend_environment_and_are_never_in_repr():
    env = {"MARKET_DATA_API_KEY": f" {MKEY} ", "NEWS_API_KEY": NKEY, "RERANKER_API_KEY": RKEY, "COHERE_API_KEY": "old-cohere", "OPENAI_API_KEY": OKEY, "DART_API_KEY": DKEY,
           "MARKET_DATA_PROVIDER": "Paid", "NEWS_PROVIDER": "PAID"}
    s = load_settings(env=env)
    assert (s.market_data_api_key, s.news_api_key, s.reranker_api_key, s.market_data_provider, s.news_provider) == (MKEY, NKEY, RKEY, "paid", "paid"), "RERANKER_API_KEY 가 COHERE_API_KEY 보다 우선"
    assert load_settings(env={"COHERE_API_KEY": "old-cohere"}).reranker_api_key == "old-cohere", "예전 이름도 읽는다"
    assert set(s.secrets()) >= {MKEY, NKEY, RKEY, OKEY, DKEY}
    text = repr(s) + str(s)
    assert not any(k in text for k in (MKEY, NKEY, RKEY, OKEY, DKEY, "old-cohere"))
    d = load_settings(env={})
    assert (d.market_data_provider, d.news_provider, d.market_data_api_key, d.news_api_key) == ("yahoo", "google", "", ""), "기본 provider 는 Key 가 필요 없다"


def test_missing_key_makes_only_that_providers_tools_unavailable(paid):
    ext = build_external(settings(market_data_provider="paid", news_provider="paid"))      # Key 없음
    assert isinstance(ext.market, UnavailableProvider) and isinstance(ext.news, UnavailableProvider) and paid == []
    tools = make_external_tools(ExternalProviders(ext.market, FakeRates(), ext.comparables, ext.news), resolver)   # 금리 provider 는 Key 가 필요 없는 mock
    ctx = {"corpCode": SAMSUNG, "corpName": "삼성전자", "support": "supported"}
    for name, expect in (("getMarketData", "MARKET_DATA_API_KEY"), ("getComparableCompanies", "MARKET_DATA_API_KEY"), ("searchCompanyNews", "NEWS_API_KEY")):
        r = tools[name](ctx, {})
        assert r["status"] == "unavailable" and expect in r["reason"] and "not configured" in r["reason"] and "data" not in r and r["sources"] == [], name
    # WACC 근거 Tool 은 부분 결과: 시장 provider(베타)만 막히고 무위험수익률은 계속 제공된다 — 값을 지어내지 않는다
    wa = tools["getMarketAssumptions"](ctx, {})
    assert wa["status"] == "ok" and wa["data"]["riskFreeRate"]["rate"] == 0.04286 and wa["data"]["beta"]["status"] == "missing" and any(w["code"] == "partial-data" for w in wa["warnings"])
    # 시장 provider 가 없어도 금리(Rf) provider 는 따로 동작한다: 부분 결과로 계속 답한다
    ext2 = build_external(settings(market_data_provider="paid", news_provider="google"))
    assert not isinstance(ext2.news, UnavailableProvider) and not isinstance(ext2.rates, UnavailableProvider)
    # Key 가 있으면 같은 Tool contract 로 정상 동작한다 (provider 교체)
    ext3 = build_external(settings(market_data_provider="paid", news_provider="paid", market_data_api_key=MKEY, news_api_key=NKEY))
    assert sorted(paid) == [("market", MKEY), ("news", NKEY)]
    t3 = make_external_tools(ExternalProviders(ext3.market, FakeRates(), ext3.comparables, ext3.news), resolver)
    md, news = t3["getMarketData"](ctx, {}), t3["searchCompanyNews"](ctx, {})
    assert md["status"] == "ok" and news["status"] == "ok" and md["sources"][0]["type"] == "market-data" and news["sources"][0]["type"] == "news"
    assert not any(k in json.dumps([md, news], ensure_ascii=False) for k in ALL_KEYS)
    # 알 수 없는 provider 이름도 그 Tool 만 unavailable
    bad = build_external(settings(market_data_provider="nope"))
    assert isinstance(bad.market, UnavailableProvider) and "not supported" in make_external_tools(bad, resolver)["getMarketData"](ctx, {})["reason"]


def test_missing_keys_do_not_break_the_ai_analyst_loop(paid):
    ext = build_external(settings(market_data_provider="paid", news_provider="paid"))
    tools = make_external_tools(ExternalProviders(ext.market, FakeRates(ProviderError("unavailable", "rates down")), ext.comparables, ext.news), resolver)
    provider = MockProvider([tool_call("getForecastAssumptions", {}, id_="f1"), tool_call("getMarketAssumptions", {}, id_="m1"), tool_call("searchCompanyNews", {}, id_="n1"), final()])
    gw = AiGateway(provider, derive_secret("", OKEY), backend_tools=tools)
    r = gw.query("WACC 검토와 최근 뉴스", CTX)
    out = gw.tool_result(r["state"], r["callId"], ok_result("getForecastAssumptions"), r["conversationId"])
    assert out["status"] == "final", "provider Key 가 없어도 대화는 끝까지 간다"
    assert [t["status"] for t in out["toolTrace"]] == ["ok", "unavailable", "unavailable"]
    sent = json.loads(provider.calls[-1]["messages"][-1]["content"])
    assert sent["status"] == "unavailable" and "NEWS_API_KEY" in sent["reason"]
    assert not any(k in json.dumps(out, ensure_ascii=False) for k in ALL_KEYS)
    # 기업 목록(DART)을 읽지 못해도 외부 Tool 만 unavailable 이다
    def broken(code):
        raise ProviderError("unavailable", "The company directory (DART) is not available, so the ticker cannot be resolved.")
    t = make_external_tools(ExternalProviders(FakeMarket(), FakeRates(), FakeComps(PEERS), FakeNews(NEWS)), broken)
    assert t["getMarketData"]({"corpCode": SAMSUNG, "support": "supported"}, {})["status"] == "unavailable"


def test_secrets_never_reach_responses_audit_or_logs(paid):
    class Leaky(FakeMarket):
        def snapshot_by_stock_code(self, code):
            raise RuntimeError(f"401 Unauthorized for https://api.vendor.example/quote?apikey={MKEY}&symbol={code}")
    buf = io.StringIO()
    handler = logging.StreamHandler(buf)
    handler.setFormatter(logging.Formatter("%(name)s %(message)s"))
    lg = logging.getLogger("valuflow")
    lg.addHandler(handler)
    lg.setLevel(logging.DEBUG)
    try:
        app = create_app(settings(market_data_api_key=MKEY, news_api_key=NKEY, reranker_api_key=RKEY, external_data=False),
                         ai=AiGateway(MockProvider([tool_call("getMarketData", {}, id_="m1"), final()]), derive_secret("", OKEY),
                                      backend_tools=make_external_tools(ExternalProviders(Leaky(), FakeRates(), FakeComps(PEERS), FakeNews(NEWS)), resolver)))
        install = __import__("app.secrets", fromlist=["install_redaction"]).install_redaction
        install(list(ALL_KEYS))   # create_app 이 설정한 filter 를 이 테스트의 handler 에도 건다
        c = TestClient(app, raise_server_exceptions=False)
        responses = [c.get("/api/health").text, c.get("/api/companies").text, c.post("/api/ai/query", json={"question": "x" * 3000}).text, c.post("/api/knowledge/documents").text]
        q = c.post("/api/ai/query", json={"question": "시가총액", "minimalContext": CTX})
        responses.append(q.text)
        assert q.status_code == 200 and q.json()["status"] == "final" and q.json()["backendToolResults"][0]["status"] == "unavailable"
        assert q.json()["backendToolResults"][0]["reason"] == "Tool failed (internal error)." , "예상치 못한 provider 예외의 원문(URL · Key)은 모델 · 응답에 싣지 않는다"
        logging.getLogger("valuflow.test").error("provider call failed: %s", f"https://x.example/?key={MKEY} dart={DKEY}")
        logging.getLogger("valuflow.test").error("bad %s", RuntimeError(f"token={NKEY}"))
        assert not any(k in r for r in responses for k in ALL_KEYS)
        logs = buf.getvalue()
        assert "backend tool getMarketData failed (RuntimeError)" in logs and MASK in logs, "예외 종류만 로그에 남는다"
        assert not any(k in logs for k in ALL_KEYS), logs
    finally:
        lg.removeHandler(handler)
    f = RedactingFilter([OKEY, "x"])
    rec = logging.LogRecord("t", logging.ERROR, "f", 1, f"error {OKEY}", None, None)
    f.filter(rec)
    assert OKEY not in rec.getMessage() and "x" not in f._secrets, "너무 짧은 값은 가리지 않는다"


def test_unit_tests_use_mock_providers_and_live_smoke_is_key_gated():
    here = Path(__file__).parent
    for name in ("test_live_external.py", "test_live_rag.py", "test_live_ai.py", "test_live_smoke.py"):
        text = (here / "smoke" / name).read_text(encoding="utf-8")
        assert "skipif" in text and ("API_KEY" in text or "has_api_key" in text or "has_ai" in text), name
    for name in ("test_external_tools.py", "test_credentials.py"):
        assert "no_network" in (here / name).read_text(encoding="utf-8") or name == "test_credentials.py"
    assert not any(k in repr(Settings()) for k in ALL_KEYS)


# ---- provider 신뢰 등급 (STEP 08-4 보완) ----
def test_tool_results_expose_provider_reliability_and_never_claim_official():
    from app.external.providers import ProviderInfo
    from app.external.yahoo import INFO as YAHOO
    from app.external.fred import FredRiskFree
    from app.external.news import GoogleNews
    assert (YAHOO.reliability, YAHOO.tier, YAHOO.valuation_grade) == ("unofficial", "development", False) and "development/demo" in YAHOO.note
    assert FredRiskFree.info.reliability == "secondary" and GoogleNews.info.reliability == "unofficial" and not GoogleNews.info.valuation_grade
    d = YAHOO.to_dict()
    assert d["official"] is False and d["valuationGrade"] is False and set(d) == {"name", "official", "reliability", "tier", "valuationGrade", "note"}

    class Shaped(FakeMarket):
        info = YAHOO
    class Official(FakeMarket):
        info = ProviderInfo("KRX", "official", "production", True, "Exchange data.")
    ctx = {"corpCode": SAMSUNG, "corpName": "삼성전자", "support": "supported"}
    r = make_external_tools(ExternalProviders(Shaped(), FakeRates(), FakeComps(PEERS), FakeNews(NEWS)), resolver)["getMarketData"](ctx, {})
    assert r["data"]["providers"][0]["reliability"] == "unofficial" and r["data"]["providers"][0]["official"] is False
    w = [x for x in r["warnings"] if x["code"] == "provider-reliability"]
    assert w and "development/demo" in w[0]["text"] and "Never describe it as official market data" in w[0]["text"]
    assert r["sources"][0]["note"] == "unofficial provider (development tier)"
    # 공식 provider 로 교체해도 Tool contract(필드)는 그대로이고, 비공식 경고만 사라진다
    off = make_external_tools(ExternalProviders(Official(), FakeRates(), FakeComps(PEERS), FakeNews(NEWS)), resolver)["getMarketData"](ctx, {})
    assert set(off["data"]) == set(r["data"]) and set(off["sources"][0]) == set(r["sources"][0])
    assert off["data"]["providers"][0]["official"] is True and not [x for x in off["warnings"] if x["code"] == "provider-reliability"]
    for name, args in (("getMarketAssumptions", {}), ("getComparableCompanies", {}), ("searchCompanyNews", {})):
        res = make_external_tools(ExternalProviders(Shaped(), FakeRates(), FakeComps(PEERS), FakeNews(NEWS)), resolver)[name](ctx, args)
        assert res["data"]["providers"] and any(x["code"] == "provider-reliability" for x in res["warnings"]), name
    assert "never call their data \"official market data\"" in __import__("app.ai.catalog", fromlist=["load_catalog"]).load_catalog()["systemInstruction"]


def test_production_env_blocks_development_providers_and_health_reports_reliability():
    dev = build_external(settings())
    assert not isinstance(dev.market, UnavailableProvider) and dev.market.info.tier == "development"
    prod = build_external(settings(app_env="production"))
    for p in (prod.market, prod.rates, prod.comparables, prod.news):
        assert isinstance(p, UnavailableProvider) and "APP_ENV=production" in p.info.note
    tools = make_external_tools(ExternalProviders(prod.market, prod.rates, prod.comparables, prod.news), resolver)
    r = tools["getMarketData"]({"corpCode": SAMSUNG, "corpName": "삼성전자", "support": "supported"}, {})
    assert r["status"] == "unavailable" and "development/demo provider" in r["reason"] and "official or commercial provider" in r["reason"]
    h = TestClient(create_app(settings(), external=dev)).get("/api/health").json()
    assert h["appEnv"] == "development" and h["externalProviders"]["market"]["reliability"] == "unofficial" and h["externalProviders"]["market"]["official"] is False
    assert not any(k in json.dumps(h) for k in ALL_KEYS)
    assert load_settings(env={"APP_ENV": "Production"}).app_env == "production" and Settings().app_env == "development"
