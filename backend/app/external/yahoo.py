"""Yahoo Finance adapter (yfinance, 공식 API 가 아닌 비공식 접근): 한국 상장사(.KS 코스피 · .KQ 코스닥) 시세 · 재무 지표 · 같은 산업 종목 screener.
API Key 가 필요 없지만 비공식이라 지연 · 차단 · 필드 누락이 있을 수 있다. 이 모듈만 yfinance 를 import 하며 (lazy), 호출 함수는 주입할 수 있어 테스트는 네트워크를 쓰지 않는다."""
from __future__ import annotations

import math
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
from typing import Any, Callable, Literal

from app.external.cache import TTLCache
from app.external.errors import ProviderError
from app.external.providers import MarketSnapshot

SOURCE = "Yahoo Finance"
KOREA_EXCHANGES = ("KSC", "KOE")   # KOSPI, KOSDAQ (Yahoo exchange code)
SUFFIXES = (".KS", ".KQ")

InfoFetcher = Callable[[str], dict[str, Any]]
Screener = Callable[[str | None, tuple[str, ...] | None, int], list[dict[str, Any]]]


def _num(x: Any) -> float | None:
    if isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x):
        return None
    return float(x)


def _ts(x: Any) -> datetime | None:
    n = _num(x)
    return datetime.fromtimestamp(n, tz=timezone.utc) if n else None


def _date(x: Any) -> date | None:
    t = _ts(x)
    return t.date() if t else None


def default_info(symbol: str) -> dict[str, Any]:
    import yfinance as yf
    return yf.Ticker(symbol).info


def default_screen(industry: str | None, exchanges: tuple[str, ...] | None, size: int) -> list[dict[str, Any]]:
    import yfinance as yf
    from yfinance import EquityQuery
    conds = []
    if exchanges:
        conds.append(EquityQuery("is-in", ["exchange", *exchanges]) if len(exchanges) > 1 else EquityQuery("eq", ["exchange", exchanges[0]]))
    if industry:
        conds.append(EquityQuery("eq", ["industry", industry]))
    if not conds:
        raise ProviderError("no-data", "No screening criteria.")
    q = conds[0] if len(conds) == 1 else EquityQuery("and", conds)
    return yf.screen(q, size=size, sortField="intradaymarketcap", sortAsc=False).get("quotes", [])


def _classify(e: Exception) -> ProviderError:
    text = f"{type(e).__name__} {e}".lower()
    if "ratelimit" in text or "rate limit" in text or "429" in text or "too many requests" in text:
        return ProviderError("rate-limit", "The market data provider rate limit was reached. Try again later.")
    return ProviderError("unavailable", "The market data provider could not be reached.")  # 원문 오류 · URL 은 노출하지 않는다


def to_snapshot(symbol: str, info: dict[str, Any], fetched_at: datetime) -> MarketSnapshot:
    price = _num(info.get("currentPrice")) or _num(info.get("regularMarketPrice"))
    return MarketSnapshot(
        symbol=symbol, name=info.get("longName") or info.get("shortName"), exchange=info.get("exchange"), currency=info.get("currency"), price=price,
        price_time=_ts(info.get("regularMarketTime")), market_cap=_num(info.get("marketCap")), shares_outstanding=_num(info.get("sharesOutstanding")),
        high_52w=_num(info.get("fiftyTwoWeekHigh")), low_52w=_num(info.get("fiftyTwoWeekLow")), beta=_num(info.get("beta")), total_debt=_num(info.get("totalDebt")),
        debt_to_equity=_num(info.get("debtToEquity")), most_recent_quarter=_date(info.get("mostRecentQuarter")),
        industry=info.get("industry"), sector=info.get("sector"), country=info.get("country"), revenue=_num(info.get("totalRevenue")),
        financial_currency=info.get("financialCurrency"), operating_margin=_num(info.get("operatingMargins")), revenue_growth=_num(info.get("revenueGrowth")),
        per=_num(info.get("trailingPE")), pbr=_num(info.get("priceToBook")), ev_ebitda=_num(info.get("enterpriseToEbitda")), fetched_at=fetched_at, source=SOURCE)


class YahooMarketData:
    name = SOURCE

    def __init__(self, fetch_info: InfoFetcher = default_info, cache: TTLCache | None = None, quote_ttl: float = 300, fundamentals_ttl: float = 86400,
                 clock: Callable[[], datetime] = lambda: datetime.now(timezone.utc)):
        self._fetch, self._cache, self._quote_ttl, self._fund_ttl, self._clock = fetch_info, cache or TTLCache(), quote_ttl, fundamentals_ttl, clock

    def snapshot(self, symbol: str, ttl: float | None = None) -> MarketSnapshot:
        def load() -> MarketSnapshot:
            try:
                info = self._fetch(symbol)
            except ProviderError:
                raise
            except Exception as e:  # noqa: BLE001
                raise _classify(e) from None
            snap = to_snapshot(symbol, info or {}, self._clock())
            if snap.price is None and snap.market_cap is None:
                raise ProviderError("no-data", "The provider has no market data for this symbol.")
            return snap
        return self._cache.get_or_load(f"snap:{symbol}", ttl if ttl is not None else self._quote_ttl, load)

    def snapshot_by_stock_code(self, stock_code: str) -> MarketSnapshot:
        """코스피(.KS) → 코스닥(.KQ) 순으로 시도한다. 종목코드는 서버가 corp code 목록에서 찾은 값이며 AI 가 지정한 값이 아니다."""
        code = "".join(ch for ch in stock_code if ch.isdigit())
        if len(code) != 6:
            raise ProviderError("no-data", "This company has no listed stock code.")
        last: ProviderError | None = None
        for suffix in SUFFIXES:
            try:
                return self.snapshot(code + suffix)
            except ProviderError as e:
                if e.kind != "no-data":
                    raise
                last = e
        raise last or ProviderError("no-data", "The provider has no market data for this stock code.")

    def fundamentals(self, symbol: str) -> MarketSnapshot:
        return self.snapshot(symbol, self._fund_ttl)


class YahooComparables:
    name = SOURCE

    def __init__(self, market: YahooMarketData, screen: Screener = default_screen, cache: TTLCache | None = None, ttl: float = 86400, workers: int = 4):
        self._market, self._screen, self._cache, self._ttl, self._workers = market, screen, cache or TTLCache(), ttl, workers

    def candidates(self, subject: MarketSnapshot, scope: Literal["korea", "global"], industry: str | None, limit: int) -> list[MarketSnapshot]:
        ind = industry or subject.industry
        if not ind:
            raise ProviderError("no-data", "The subject company has no industry classification to screen on.")
        exchanges = KOREA_EXCHANGES if scope == "korea" else None

        def load() -> list[dict[str, Any]]:
            try:
                return self._screen(ind, exchanges, min(limit * 3, 30))
            except ProviderError:
                raise
            except Exception as e:  # noqa: BLE001
                raise _classify(e) from None
        quotes = self._cache.get_or_load(f"screen:{ind}:{scope}:{limit}", self._ttl, load)
        symbols = [q["symbol"] for q in quotes if q.get("symbol") and q["symbol"] != subject.symbol][: limit * 2]

        def fetch(sym: str) -> MarketSnapshot | None:
            try:
                return self._market.fundamentals(sym)
            except ProviderError as e:
                if e.kind == "rate-limit":
                    raise
                return None   # 한 종목의 실패가 후보 전체를 막지 않는다
        with ThreadPoolExecutor(max_workers=self._workers) as pool:
            snaps = list(pool.map(fetch, symbols))
        return [s for s in snaps if s is not None and s.market_cap is not None]
