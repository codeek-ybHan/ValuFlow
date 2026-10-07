"""ValuFlow backend. React 는 이 서버만 호출하고, OpenDART 와 API Key 는 이 서버 안에만 있다."""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from fastapi import FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.config import Settings, load_settings
from app.dart.client import DartHttpClient
from app.dart.company import parse_company
from app.dart.corp_codes import CorpCodeCache, search_companies
from app.dart.models import DartApiError, ERROR_MESSAGES, HTTP_STATUS, CompanyDetail, CorpRecord

CORP_CODE_PATTERN = re.compile(r"^\d{8}$")
MAX_LIMIT = 50


def _summary(r: CorpRecord) -> dict[str, Any]:
    return {"corpCode": r.corp_code, "corpName": r.corp_name, "stockCode": r.stock_code, "modifyDate": r.modify_date}


def _detail(d: CompanyDetail, fetched_at: str) -> dict[str, Any]:
    return {
        "corpCode": d.corp_code, "corpName": d.corp_name, "corpNameEng": d.corp_name_eng, "stockCode": d.stock_code,
        "ceoName": d.ceo_name, "corpClass": d.corp_class, "address": d.address, "homepage": d.homepage,
        "industryCode": d.industry_code, "establishmentDate": d.establishment_date, "fiscalMonth": d.fiscal_month,
        "source": "OpenDART", "fetchedAt": fetched_at,
    }


def _error(code: str, message: str) -> JSONResponse:
    return JSONResponse({"error": {"code": code, "message": message}}, status_code=HTTP_STATUS.get(code, 502))  # type: ignore[arg-type]


def create_app(settings: Settings | None = None, dart: DartHttpClient | None = None, cache: CorpCodeCache | None = None) -> FastAPI:
    settings = settings or load_settings()
    dart = dart or DartHttpClient(settings)
    cache = cache or CorpCodeCache(dart.fetch_corp_code_zip)
    app = FastAPI(title="ValuFlow Backend")

    @app.exception_handler(DartApiError)
    async def _dart_error(_: Request, exc: DartApiError) -> JSONResponse:
        return _error(exc.code, exc.message)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, __: RequestValidationError) -> JSONResponse:
        return _error("invalid-request", ERROR_MESSAGES["invalid-request"])

    @app.exception_handler(Exception)
    async def _unexpected(_: Request, __: Exception) -> JSONResponse:
        return _error("unknown", ERROR_MESSAGES["unknown"])  # 내부 오류 내용은 노출하지 않는다

    @app.get("/api/health")
    def health() -> dict[str, Any]:
        return {"status": "ok", "dartConfigured": settings.has_api_key, "corpCodesFetchedAt": cache.fetched_at}

    @app.get("/api/companies")
    def companies(q: str = Query(..., max_length=100), limit: int = Query(20, ge=1, le=MAX_LIMIT)) -> dict[str, Any]:
        found = search_companies(cache.get(), q, limit)
        return {"query": q.strip(), "items": [_summary(r) for r in found], "corpCodesFetchedAt": cache.fetched_at}

    @app.post("/api/companies/refresh")
    def refresh() -> dict[str, Any]:
        records = cache.get(refresh=True)
        return {"count": len(records), "corpCodesFetchedAt": cache.fetched_at}

    @app.get("/api/companies/{corp_code}")
    def company(corp_code: str) -> dict[str, Any]:
        if not CORP_CODE_PATTERN.match(corp_code):
            raise DartApiError("invalid-request", "corpCode 는 8자리 숫자여야 합니다.")
        detail = parse_company(dart.fetch_company(corp_code))
        return _detail(detail, datetime.now(timezone.utc).isoformat())

    return app


def get_app() -> FastAPI:
    return create_app()
