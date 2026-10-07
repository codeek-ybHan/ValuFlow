"""외부 데이터 provider 선택 + credential 정책.

- 모든 credential 은 backend 환경변수(Settings)에만 있다. provider 마다 Key 가 필요한지(requires_key)를 선언하고, 필요한 Key 가 없으면
  그 provider 대신 UnavailableProvider 가 들어가 해당 Tool 만 status "unavailable"(사유: 어떤 환경변수가 필요한지, Key 값은 절대 아님)이 된다.
  다른 Tool 과 AI Analyst 전체는 정상 동작한다.
- provider 를 바꿔도 Tool contract 는 그대로다: Tool 은 providers.py 의 Protocol 에만 의존한다.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from app.ai.external_tools import ExternalProviders
from app.config import Settings
from app.external.errors import ProviderError
from app.external.providers import ProviderInfo, provider_info
from app.external.fred import FredRiskFree
from app.external.news import GoogleNews
from app.external.yahoo import YahooComparables, YahooMarketData


@dataclass(frozen=True)
class ProviderSpec:
    name: str
    requires_key: bool
    build: Callable[[Settings, Any], Any]   # (settings, shared market provider | None) → provider


class UnavailableProvider:
    """credential 이 없거나 알 수 없는 provider: 모든 호출이 ProviderError("unavailable")이며 값을 만들지 않는다."""

    def __init__(self, name: str, reason: str):
        self.name, self._reason = name, reason
        self.info = ProviderInfo(name, "unknown", "development", False, reason)

    def _fail(self, *a: Any, **k: Any) -> Any:
        raise ProviderError("unavailable", self._reason)

    snapshot_by_stock_code = risk_free_rate = candidates = search = _fail


MARKET_PROVIDERS: dict[str, ProviderSpec] = {
    "yahoo": ProviderSpec("yahoo", False, lambda s, _m: YahooMarketData(quote_ttl=s.market_ttl, fundamentals_ttl=s.fundamentals_ttl)),
}
RATE_PROVIDERS: dict[str, ProviderSpec] = {"fred": ProviderSpec("fred", False, lambda s, _m: FredRiskFree(ttl=s.rate_ttl))}
COMPARABLE_PROVIDERS: dict[str, ProviderSpec] = {"yahoo": ProviderSpec("yahoo", False, lambda s, m: YahooComparables(m, ttl=s.fundamentals_ttl))}
NEWS_PROVIDERS: dict[str, ProviderSpec] = {"google": ProviderSpec("google", False, lambda s, _m: GoogleNews(ttl=s.news_ttl))}


def _production_gate(provider: Any, kind: str, settings: Settings) -> Any:
    """APP_ENV=production 에서는 development 등급 provider(비공식 · 개인용)를 쓰지 않는다: 그 Tool 만 unavailable 이 된다 (운영용 provider 를 등록하면 풀린다)."""
    info = provider_info(provider)
    if settings.app_env == "production" and info.tier != "production" and not isinstance(provider, UnavailableProvider):
        return UnavailableProvider(info.name, f"The {kind} provider '{info.name}' is a development/demo provider ({info.reliability}) and is not allowed when APP_ENV=production. Configure an official or commercial provider.")
    return provider


def _pick(registry: dict[str, ProviderSpec], name: str, key: str, key_env: str, kind: str, settings: Settings, market: Any = None) -> Any:
    spec = registry.get(name)
    if spec is None:
        return UnavailableProvider(name, f"The {kind} provider '{name}' is not supported. Check the provider setting.")
    if spec.requires_key and not key:
        return UnavailableProvider(name, f"The {kind} provider '{name}' requires {key_env}, which is not configured.")   # Key 값이 아니라 환경변수 이름만 알려 준다
    return _production_gate(spec.build(settings, market), kind, settings)


def build_external(settings: Settings) -> ExternalProviders:
    market = _pick(MARKET_PROVIDERS, settings.market_data_provider, settings.market_data_api_key, "MARKET_DATA_API_KEY", "market data", settings)
    comps_market = market if not isinstance(market, UnavailableProvider) else None
    comparables = (_pick(COMPARABLE_PROVIDERS, settings.market_data_provider, settings.market_data_api_key, "MARKET_DATA_API_KEY", "comparable companies", settings, comps_market)
                   if comps_market is not None else market)
    rates = _pick(RATE_PROVIDERS, "fred", "", "", "risk-free rate", settings)
    news = _pick(NEWS_PROVIDERS, settings.news_provider, settings.news_api_key, "NEWS_API_KEY", "news", settings)
    return ExternalProviders(market, rates, comparables, news)
