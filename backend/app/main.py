"""ValuFlow backend. React 는 이 서버만 호출하고, OpenDART 와 API Key 는 이 서버 안에만 있다."""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from fastapi import FastAPI, Query, Request
from pydantic import BaseModel, Field
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.config import Settings, load_settings
from app.dart.client import DartHttpClient
from app.dart.company import parse_company
from app.dart.corp_codes import CorpCodeCache, search_companies
from app.dart.financials import FinancialsService
from app.db.session import create_db_engine, make_session_factory
from app.services.financial_store import FinancialStore
from app.services.historical import HistoricalService
from app.ai.errors import AiGatewayError, MESSAGES as AI_MESSAGES
from app.ai.gateway import AiGateway
from app.ai.provider import OpenAiProvider
from app.ai.runtime import make_search_disclosures
from app.dart.filings import DartDisclosureSource, FilingsSource
from app.rag.embeddings import EmbeddingProvider, OpenAiEmbeddings
from app.rag.ingestion import DisclosureIngestionService
from app.rag.retrieval import DisclosureRetriever
from app.rag.store import DisclosureStore
from app.ai.state import derive_secret
from app.dart.models import DartApiError, ERROR_MESSAGES, HTTP_STATUS, CompanyDetail, CorpRecord, FinancialAccount, FinancialsQuality

CORP_CODE_PATTERN = re.compile(r"^\d{8}$")
MAX_LIMIT = 50
MAX_YEARS = 5
MIN_YEAR = 2015  # OpenDART 전체 재무제표 제공 범위 이내의 보수적 하한


class AiQueryRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    minimalContext: dict[str, Any] | None = None
    toolNames: list[str] | None = None
    classification: dict[str, Any] | None = None  # routing hint (기록용). 모델 선택을 대체하지 않는다

class AiToolResultRequest(BaseModel):
    conversationId: str = Field(min_length=1, max_length=64)
    state: str = Field(min_length=1, max_length=600_000)
    callId: str = Field(min_length=1, max_length=128)
    toolResult: dict[str, Any]



def _summary(r: CorpRecord) -> dict[str, Any]:
    return {"corpCode": r.corp_code, "corpName": r.corp_name, "stockCode": r.stock_code, "modifyDate": r.modify_date}


def _detail(d: CompanyDetail, fetched_at: str) -> dict[str, Any]:
    return {
        "corpCode": d.corp_code, "corpName": d.corp_name, "corpNameEng": d.corp_name_eng, "stockCode": d.stock_code,
        "ceoName": d.ceo_name, "corpClass": d.corp_class, "address": d.address, "homepage": d.homepage,
        "industryCode": d.industry_code, "establishmentDate": d.establishment_date, "fiscalMonth": d.fiscal_month,
        "source": "OpenDART", "fetchedAt": fetched_at,
    }


def _account(a: FinancialAccount) -> dict[str, Any]:
    return {
        "accountName": a.account_name, "accountId": a.account_id, "statementType": a.statement_type, "rawStatementType": a.raw_statement_type,
        "basis": a.basis, "fiscalYear": a.fiscal_year, "reportYear": a.report_year, "amount": a.amount,
        "currency": a.currency, "unit": "KRW", "raw": a.raw,
    }


def _quality(q: FinancialsQuality) -> dict[str, Any]:
    return {
        "basisRequested": q.basis_requested, "basisUsed": q.basis_used, "basisFallback": q.basis_fallback,
        "yearsRequested": q.years_requested, "yearsReceived": q.years_received, "missingYears": q.missing_years,
        "rawAccountCount": q.raw_account_count, "warnings": q.warnings,
    }


def _parse_years(raw: str) -> list[int]:
    try:
        years = sorted({int(x) for x in raw.split(",") if x.strip()})
    except ValueError:
        raise DartApiError("invalid-request", "years 는 쉼표로 구분한 연도여야 합니다.") from None
    if not years or len(years) > MAX_YEARS or years[0] < MIN_YEAR or years[-1] > datetime.now().year:
        raise DartApiError("invalid-request", f"years 는 {MIN_YEAR}년 이후 최대 {MAX_YEARS}개 연도여야 합니다.")
    return years


def _error(code: str, message: str) -> JSONResponse:
    return JSONResponse({"error": {"code": code, "message": message}}, status_code=HTTP_STATUS.get(code, 502))  # type: ignore[arg-type]


def create_app(settings: Settings | None = None, dart: DartHttpClient | None = None, cache: CorpCodeCache | None = None, financials: FinancialsService | None = None,
               store: FinancialStore | None = None, historical: HistoricalService | None = None, ai: AiGateway | None = None,
               embedder: EmbeddingProvider | None = None, disclosure_source: FilingsSource | None = None) -> FastAPI:
    settings = settings or load_settings()
    dart = dart or DartHttpClient(settings)
    cache = cache or CorpCodeCache(dart.fetch_corp_code_zip)
    financials = financials or FinancialsService(dart.fetch_financials)
    if store is None and settings.has_database:
        store = FinancialStore(make_session_factory(create_db_engine(settings)))  # connect 는 첫 사용 시점
    historical = historical or HistoricalService(financials, cache, store)
    # 공시 Retrieval: DB(pgvector)와 embedding provider 가 모두 있을 때만 켜진다 (embedding 호출은 backend 에서만)
    if embedder is None and settings.has_ai:
        embedder = OpenAiEmbeddings(settings.openai_api_key, settings.embedding_model, settings.openai_base_url)
    retriever = ingestion = disclosure_store = None
    if store is not None and embedder is not None:
        disclosure_store = DisclosureStore(store.session_factory)
        retriever = DisclosureRetriever(store.session_factory, embedder, min_score=settings.retrieval_min_score)
        ingestion = DisclosureIngestionService(disclosure_source or DartDisclosureSource(dart), embedder, disclosure_store)
    backend_tools = {"searchDisclosures": make_search_disclosures(retriever)} if retriever is not None else {}
    if ai is None and settings.has_ai:
        ai = AiGateway(OpenAiProvider(settings.openai_api_key, settings.openai_model, settings.openai_base_url),
                       derive_secret(settings.ai_state_secret, settings.openai_api_key), max_tool_calls=settings.ai_max_tool_calls, backend_tools=backend_tools)
    app = FastAPI(title="ValuFlow Backend")

    @app.exception_handler(DartApiError)
    async def _dart_error(_: Request, exc: DartApiError) -> JSONResponse:
        return _error(exc.code, exc.message)

    @app.exception_handler(AiGatewayError)
    async def _ai_error(_: Request, exc: AiGatewayError) -> JSONResponse:
        return JSONResponse({"error": {"code": exc.code, "message": exc.message}}, status_code=exc.status)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, __: RequestValidationError) -> JSONResponse:
        return _error("invalid-request", ERROR_MESSAGES["invalid-request"])

    @app.exception_handler(Exception)
    async def _unexpected(_: Request, __: Exception) -> JSONResponse:
        return _error("unknown", ERROR_MESSAGES["unknown"])  # 내부 오류 내용은 노출하지 않는다

    @app.get("/api/health")
    def health() -> dict[str, Any]:
        return {"status": "ok", "dartConfigured": settings.has_api_key, "databaseConfigured": historical.persistence_enabled, "aiConfigured": ai is not None, "disclosureSearchConfigured": retriever is not None, "corpCodesFetchedAt": cache.fetched_at}

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
        if store is not None:
            try:  # 기업 정보는 best effort 로 저장한다 (저장 실패가 조회를 막지 않는다)
                store.upsert_company(corp_code=detail.corp_code, corp_name=detail.corp_name, stock_code=detail.stock_code, corp_name_eng=detail.corp_name_eng, corp_class=detail.corp_class)
            except Exception:  # noqa: BLE001
                pass
        return _detail(detail, datetime.now(timezone.utc).isoformat())

    @app.get("/api/companies/{corp_code}/financials")
    def company_financials(
        corp_code: str,
        years: str = Query(..., max_length=60),
        basis: str = Query("auto", pattern="^(auto|consolidated|separate)$"),
        refresh: bool = False,
    ) -> dict[str, Any]:
        """사업보고서 기준 단일회사 전체 재무제표를 Raw 행으로 돌려준다. OpenDART 파라미터(reprt_code, fs_div …)는 서버 안에서만 쓴다."""
        if not CORP_CODE_PATTERN.match(corp_code):
            raise DartApiError("invalid-request", "corpCode 는 8자리 숫자여야 합니다.")
        accounts, quality, fetched_at, cached = financials.collect(corp_code, _parse_years(years), basis, refresh=refresh)  # type: ignore[arg-type]
        if not accounts:
            raise DartApiError("no-data", "해당 기업의 사업보고서 재무제표가 없습니다.")
        return {"corpCode": corp_code, "accounts": [_account(a) for a in accounts], "quality": _quality(quality),
                "source": "OpenDART", "fetchedAt": fetched_at, "cached": cached}

    @app.get("/api/companies/{corp_code}/historical")
    def company_historical(
        corp_code: str,
        years: str = Query(..., max_length=60),
        basis: str = Query("auto", pattern="^(auto|consolidated|separate)$"),
        refresh: bool = False,
    ) -> dict[str, Any]:
        """정규화된 HistoricalData + DataQuality. Database 우선, 없거나 refresh=true 면 OpenDART 재조회 → 정규화 → 저장.
        지원하지 않는 / 불완전한 기업도 200 으로 status(unsupported | incomplete)와 사유를 돌려준다. HistoricalAnalysis 등 파생값은 포함하지 않는다."""
        if not CORP_CODE_PATTERN.match(corp_code):
            raise DartApiError("invalid-request", "corpCode 는 8자리 숫자여야 합니다.")
        return historical.get(corp_code, _parse_years(years), basis, refresh=refresh)

    @app.post("/api/companies/{corp_code}/historical/renormalize")
    def company_historical_renormalize(
        corp_code: str,
        years: str = Query(..., max_length=60),
        basis: str = Query("auto", pattern="^(auto|consolidated|separate)$"),
    ) -> dict[str, Any]:
        """저장된 Raw 로 다시 정규화한다 (OpenDART 호출 없음)."""
        if not CORP_CODE_PATTERN.match(corp_code):
            raise DartApiError("invalid-request", "corpCode 는 8자리 숫자여야 합니다.")
        return historical.renormalize(corp_code, _parse_years(years), basis)

    @app.post("/api/companies/{corp_code}/disclosures/ingest")
    def ingest_disclosures(
        corp_code: str,
        years: str | None = Query(None, max_length=60),
        types: str = Query("annual", pattern="^(annual|half|quarterly)(,(annual|half|quarterly))*$"),
        limit: int = Query(3, ge=1, le=10),
        force: bool = False,
    ) -> dict[str, Any]:
        """공시 문서(사업보고서 우선)를 수집해 chunk · embedding 으로 저장한다. 같은 접수번호는 다시 ingestion 하지 않는다(force 제외)."""
        if ingestion is None:
            raise AiGatewayError("ai-not-configured", "공시 검색이 설정되어 있지 않습니다 (DATABASE_URL 과 OPENAI_API_KEY 가 필요합니다).", 503)
        if not CORP_CODE_PATTERN.match(corp_code):
            raise DartApiError("invalid-request", "corpCode 는 8자리 숫자여야 합니다.")
        return ingestion.ingest(corp_code, types.split(","), _parse_years(years) if years else None, limit=limit, force=force).to_dict()

    @app.get("/api/companies/{corp_code}/disclosures")
    def list_disclosures(corp_code: str) -> dict[str, Any]:
        if not CORP_CODE_PATTERN.match(corp_code):
            raise DartApiError("invalid-request", "corpCode 는 8자리 숫자여야 합니다.")
        return {"corpCode": corp_code, "items": disclosure_store.list_documents(corp_code) if disclosure_store is not None else []}

    @app.get("/api/companies/{corp_code}/fetches")
    def company_fetches(corp_code: str, limit: int = Query(20, ge=1, le=100)) -> dict[str, Any]:
        """수집 이력 (source history). DB 가 없으면 빈 목록."""
        if not CORP_CODE_PATTERN.match(corp_code):
            raise DartApiError("invalid-request", "corpCode 는 8자리 숫자여야 합니다.")
        return {"corpCode": corp_code, "items": store.list_fetches(corp_code, limit) if store is not None else []}

    def _require_ai() -> AiGateway:
        if ai is None:
            raise AiGatewayError("ai-not-configured", AI_MESSAGES["ai-not-configured"], 503)
        return ai

    @app.post("/api/ai/query")
    def ai_query(body: AiQueryRequest) -> dict[str, Any]:
        """질문을 받아 모델을 호출한다. 응답: tool-call(frontend 가 Tool 실행) | final(AiAnalystAnswer) | tool-limit."""
        return _require_ai().query(body.question, body.minimalContext, body.toolNames)

    @app.post("/api/ai/tool-result")
    def ai_tool_result(body: AiToolResultRequest) -> dict[str, Any]:
        """frontend 가 실행한 Tool 결과를 받아 모델을 이어서 호출한다."""
        result = _require_ai().tool_result(body.state, body.callId, body.toolResult, body.conversationId)
        return result

    return app


def get_app() -> FastAPI:
    return create_app()
