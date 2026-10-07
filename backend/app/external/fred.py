"""무위험수익률 adapter: FRED 의 OECD 시리즈 IRLTLT01KRM156N (대한민국 장기(10년) 국채 수익률, 월평균, %). API Key 없이 CSV 로 읽는다.
월 단위 데이터라 최신 관측은 한 달 이상 늦을 수 있다. 일별 국고채 10년물이 필요하면 한국은행 ECOS 같은 provider 를 같은 Protocol 로 추가한다."""
from __future__ import annotations

import csv
import io
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Callable

import httpx

from app.external.cache import TTLCache
from app.external.errors import ProviderError
from app.external.providers import ProviderInfo, RiskFreeRate

URL = "https://fred.stlouisfed.org/graph/fredgraph.csv"
SERIES = {"KR": ("IRLTLT01KRM156N", "Republic of Korea 10-year government bond yield (OECD long-term interest rate)")}
MAX_BYTES = 200_000


class FredRiskFree:
    name = "FRED (OECD)"
    info = ProviderInfo("FRED (OECD)", "secondary", "development", False,
                        "Redistribution of OECD monthly long-term rates (US Federal Reserve Bank of St. Louis); monthly lag. Interim source: prefer the Bank of Korea ECOS daily 10-year Treasury yield in production.")

    def __init__(self, client: httpx.Client | None = None, cache: TTLCache | None = None, ttl: float = 86400, base_url: str = URL):
        self._http, self._cache, self._ttl, self._url = client or httpx.Client(timeout=15), cache or TTLCache(), ttl, base_url

    def risk_free_rate(self, country: str = "KR") -> RiskFreeRate:
        if country not in SERIES:
            raise ProviderError("no-data", "No risk-free rate series is configured for this country.")
        series, instrument = SERIES[country]

        def load() -> RiskFreeRate:
            try:
                res = self._http.get(self._url, params={"id": series})
            except httpx.HTTPError:
                raise ProviderError("unavailable", "The interest rate provider could not be reached.") from None
            if res.status_code == 429:
                raise ProviderError("rate-limit", "The interest rate provider rate limit was reached. Try again later.")
            if res.status_code >= 400 or len(res.content) > MAX_BYTES:
                raise ProviderError("unavailable", "The interest rate provider returned an error.")
            latest: tuple[date, float] | None = None
            for row in csv.reader(io.StringIO(res.text)):
                if len(row) < 2 or row[1].strip() in ("", "."):
                    continue
                try:
                    latest = (date.fromisoformat(row[0]), float(Decimal(row[1].strip()) / 100))
                except (ValueError, InvalidOperation):
                    continue   # 헤더 · 깨진 행
            if latest is None:
                raise ProviderError("no-data", "The interest rate series has no observation.")
            return RiskFreeRate(rate=latest[1], maturity="10Y", instrument=instrument, as_of=latest[0], frequency="monthly average", source=f"FRED {series} (OECD)", country=country)
        return self._cache.get_or_load(f"rf:{country}", self._ttl, load)
