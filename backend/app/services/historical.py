"""Historical 조회 service: Database → (없거나 refresh) OpenDART → 정규화 → Database 저장 → 반환.
memory cache(FinancialsService)는 성능용 보조 계층일 뿐이며, 영속 source 는 Database 다. DATABASE_URL 이 없으면 저장 없이 동작한다."""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Callable

from sqlalchemy.exc import SQLAlchemyError

from app.dart.corp_codes import CorpCodeCache
from app.dart.financials import ANNUAL_REPORT, FinancialsService
from app.dart.models import DartApiError, FinancialAccount, FinancialsQuality
from app.normalization.normalize import normalize_financials
from app.services.financial_store import FetchKey, FinancialStore, utc_iso

log = logging.getLogger("valuflow.historical")

MODES = {"auto": ("Consolidated", True), "consolidated": ("Consolidated", False), "separate": ("Separate", False)}


def _fetch_info(q: FinancialsQuality) -> dict[str, Any]:
    return {"basisRequested": q.basis_requested, "basisUsed": q.basis_used, "basisFallback": q.basis_fallback, "yearsRequested": q.years_requested,
            "yearsReceived": q.years_received, "missingYears": q.missing_years, "rawAccountCount": q.raw_account_count, "warnings": q.warnings}


class HistoricalService:
    def __init__(self, financials: FinancialsService, corp_cache: CorpCodeCache, store: FinancialStore | None = None, clock: Callable[[], datetime] | None = None):
        self._financials = financials
        self._corp_cache = corp_cache
        self._store = store
        self._clock = clock or (lambda: datetime.now(timezone.utc))

    @property
    def persistence_enabled(self) -> bool:
        return self._store is not None

    @staticmethod
    def _response(corp_code: str, result: dict, fetch: dict, *, source: str, fetched_at: str, persisted: bool, fetch_id: int | None, persist_error: str | None = None) -> dict:
        body: dict[str, Any] = {
            "status": "ok" if result["ok"] else ("incomplete" if result["code"] == "incomplete" else "unsupported"),
            "corpCode": corp_code, "source": source, "persisted": persisted, "fetchId": fetch_id, "fetchedAt": fetched_at,
            "quality": result["quality"], "fetch": fetch,
        }
        if result["ok"]:
            body["data"] = result["data"]
        else:
            body.update({"code": result["code"], "reason": result["reason"], "missingRequired": result["missingRequired"]})
        if persist_error:
            body["persistError"] = persist_error
        return body

    def _company(self, corp_code: str) -> dict:
        rec = next((r for r in self._corp_cache.get() if r.corp_code == corp_code), None)
        if rec is None:
            raise DartApiError("no-data", "기업 목록에서 해당 corpCode 를 찾을 수 없습니다.")
        return {"corpCode": rec.corp_code, "corpName": rec.corp_name, "stockCode": rec.stock_code, "corpNameEng": rec.corp_eng_name}

    def get(self, corp_code: str, years: list[int], mode: str = "auto", refresh: bool = False) -> dict:
        key = FetchKey(corp_code, ANNUAL_REPORT, mode, tuple(years))
        # 1) Database 우선 (refresh 가 아니면). 여기서 OpenDART 를 호출하지 않는다.
        if self._store is not None and not refresh:
            hit = self._store.find_current(key)
            if hit:
                return self._response(corp_code, hit["result"], hit["fetch"], source="database", fetched_at=hit["fetchedAt"], persisted=True, fetch_id=hit["fetchId"])

        # 2) OpenDART → 정규화
        company = self._company(corp_code)
        accounts, fetch_quality, _, _ = self._financials.collect(corp_code, list(years), mode, ANNUAL_REPORT, refresh=refresh)  # type: ignore[arg-type]
        if not accounts:
            raise DartApiError("no-data", "해당 기업의 사업보고서 재무제표가 없습니다.")
        fetched_at = self._clock()
        result = self._normalize(accounts, company, sorted(set(years)), mode, fetch_quality, fetched_at)

        # 3) Database 저장 (한 transaction). 저장에 실패해도 정규화 결과는 돌려주되 persisted=False 로 알린다.
        fetch_id, persisted, persist_error = None, False, None
        if self._store is not None:
            try:
                fetch_id = self._store.save_outcome(company=company, key=key, fetch_quality=fetch_quality, accounts=accounts, result=result, fetched_at=fetched_at)
                persisted = True
            except SQLAlchemyError:
                log.exception("failed to persist financial fetch for %s", corp_code)
                persist_error = "database-error"
        return self._response(corp_code, result, _fetch_info(fetch_quality), source="opendart", fetched_at=utc_iso(fetched_at), persisted=persisted, fetch_id=fetch_id, persist_error=persist_error)

    @staticmethod
    def _normalize(accounts: list[FinancialAccount], company: dict, years: list[int], mode: str, fetch_quality: FinancialsQuality, now: datetime) -> dict:
        preferred, fallback = MODES[mode]
        result = normalize_financials(
            accounts, years, {"name": company["corpName"], "corpCode": company["corpCode"], "stockCode": company.get("stockCode")}, utc_iso(now),
            preferred_basis=preferred, allow_basis_fallback=fallback)
        # 수집 단계 warning 과 정규화 warning 을 합친다 (프론트 repository 와 같은 규칙)
        q = result["quality"]
        q["warnings"] = list(dict.fromkeys([*q["warnings"], *fetch_quality.warnings]))
        return result

    def renormalize(self, corp_code: str, years: list[int], mode: str = "auto") -> dict:
        """저장된 Raw 로 다시 정규화한다 (OpenDART 호출 없음). 정규화 규칙이 바뀐 뒤 사용한다."""
        if self._store is None:
            raise DartApiError("invalid-request", "DATABASE_URL 이 설정되어 있지 않아 저장된 Raw 가 없습니다.")
        key = FetchKey(corp_code, ANNUAL_REPORT, mode, tuple(years))
        hit = self._store.find_current(key)
        if hit is None:
            raise DartApiError("no-data", "저장된 수집 결과가 없습니다. 먼저 조회하세요.")
        company = self._store.get_company(corp_code) or self._company(corp_code)
        preferred, fallback = MODES[mode]
        fq = hit["fetch"]
        fetch_quality = FinancialsQuality(basis_requested=fq["basisRequested"], basis_used=fq["basisUsed"], basis_fallback=fq["basisFallback"], years_requested=fq["yearsRequested"],
                                          years_received=fq["yearsReceived"], missing_years=fq["missingYears"], raw_account_count=fq["rawAccountCount"], warnings=fq["warnings"])
        fetched_at = datetime.fromisoformat(hit["fetchedAt"])

        def run(raw: list[FinancialAccount]) -> dict:
            return self._normalize(raw, {"corpCode": corp_code, "corpName": company["corpName"], "stockCode": company.get("stockCode")}, sorted(set(years)), mode, fetch_quality, fetched_at)

        out = self._store.renormalize(hit["fetchId"], run)
        assert out is not None
        return self._response(corp_code, out["result"], out["fetch"], source="database", fetched_at=out["fetchedAt"], persisted=True, fetch_id=out["fetchId"])
