"""외부 데이터 provider 계약. Tool 은 이 Protocol 에만 의존하므로 provider(Yahoo · FRED · Google News …)를 바꿔도 Tool contract 는 그대로다.
나중에 MCP server 가 같은 데이터를 제공하게 되면 이 Protocol 을 구현하는 adapter 하나만 추가하면 된다 (Tool · policy · 출처 형식은 변하지 않는다).
모든 값은 시점(as_of / published_at)과 출처(source)를 함께 가진다. 없는 값은 None 이며 0 으로 채우지 않는다."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from typing import Literal, Protocol


@dataclass(frozen=True)
class ProviderInfo:
    """provider 의 신뢰 등급. Tool 결과 · health 에 함께 노출되어 비공식 데이터가 "공식 시장 데이터"처럼 보이지 않게 한다.
    reliability: official(공공 · 거래소 등 공식) | commercial(계약 · SLA 가 있는 상용) | secondary(공식 통계의 재배포) | unofficial(비공식 접근) | unknown.
    tier: production(운영 사용 가능) | development(개발 · 데모 fallback 전용). valuation_grade 는 Valuation 의 재무 근거로 쓸 수 있는가 (재무 Actual 의 source of truth 는 OpenDART / ValuFlow Historical)."""
    name: str
    reliability: str
    tier: str
    valuation_grade: bool
    note: str

    def to_dict(self) -> dict:
        return {"name": self.name, "official": self.reliability == "official", "reliability": self.reliability, "tier": self.tier, "valuationGrade": self.valuation_grade, "note": self.note}


UNKNOWN_PROVIDER = ProviderInfo("unknown", "unknown", "development", False, "Provider reliability is not declared.")


def provider_info(p: object) -> ProviderInfo:
    info = getattr(p, "info", None)
    return info if isinstance(info, ProviderInfo) else ProviderInfo(str(getattr(p, "name", "unknown")), "unknown", "development", False, "Provider reliability is not declared.")


@dataclass(frozen=True)
class MarketSnapshot:
    """한 종목의 현재 시장 관측값 + provider 가 보고하는 재무 지표. 모든 값은 fetched_at 시점의 provider 값이다 (DART 공시 기준일 값이 아니다)."""
    symbol: str
    name: str | None
    exchange: str | None
    currency: str | None                 # 거래 통화 (가격 · 시가총액)
    price: float | None
    price_time: datetime | None
    market_cap: float | None
    shares_outstanding: float | None
    high_52w: float | None
    low_52w: float | None
    beta: float | None
    total_debt: float | None
    debt_to_equity: float | None         # provider 표기(%)
    most_recent_quarter: date | None     # 재무 지표(부채 · 매출 등)의 기준 분기
    industry: str | None
    sector: str | None
    country: str | None
    revenue: float | None                # 최근 12개월 매출 (financial_currency 단위)
    financial_currency: str | None
    operating_margin: float | None       # decimal
    revenue_growth: float | None         # decimal
    per: float | None
    pbr: float | None
    ev_ebitda: float | None
    fetched_at: datetime
    source: str


@dataclass(frozen=True)
class RiskFreeRate:
    rate: float                          # decimal (0.04286 = 4.286%)
    maturity: str                        # "10Y"
    instrument: str
    as_of: date                          # 관측 기준일
    frequency: str                       # "monthly average"
    source: str
    country: str


@dataclass(frozen=True)
class NewsItem:
    title: str
    publisher: str | None
    published_at: datetime
    url: str
    snippet: str | None


class MarketDataProvider(Protocol):
    name: str
    info: ProviderInfo

    def snapshot_by_stock_code(self, stock_code: str) -> MarketSnapshot:
        """6자리 종목코드로 현재 시장 관측값을 조회한다. 실패는 ProviderError."""
        ...


class RiskFreeRateProvider(Protocol):
    name: str
    info: ProviderInfo

    def risk_free_rate(self, country: str = "KR") -> RiskFreeRate: ...


class ComparableProvider(Protocol):
    name: str
    info: ProviderInfo

    def candidates(self, subject: MarketSnapshot, scope: Literal["korea", "global"], industry: str | None, limit: int) -> list[MarketSnapshot]:
        """subject 와 같은 산업 분류에서 실제 종목 후보를 가져온다 (provider 데이터 기반, 이름을 지어내지 않는다)."""
        ...


class NewsProvider(Protocol):
    name: str
    info: ProviderInfo

    def search(self, query: str, days: int, limit: int) -> list[NewsItem]: ...
