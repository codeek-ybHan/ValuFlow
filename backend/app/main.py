"""ValuFlow backend. React 는 이 서버만 호출하고, OpenDART 와 API Key 는 이 서버 안에만 있다."""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Any

from fastapi import Body, FastAPI, File, Form, Path, Query, Request, UploadFile
from urllib.parse import quote
from pydantic import BaseModel, Field
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response

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
from app.ai.runtime import make_retrieval_tools
from app.knowledge.loaders.pdf_loader import PdfError
from app.report.pdf import ReportError, render_pdf
from app.knowledge.service import KnowledgeService, parse_meta
from app.rag.rerank import Reranker, build_reranker
from app.ai.external_tools import ExternalProviders, TickerInfo, make_external_tools
from app.external.errors import ProviderError
from app.external.providers import provider_info
from app.external.registry import build_external
from app.secrets import install_redaction
from app.security import access_state, install_security
from app.services.snapshot_store import SnapshotError, SnapshotStore
from sqlalchemy import text as sql_text
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
    workflow: dict[str, Any] | None = None        # Agent workflow 계획 (gateway 가 종류 · Tool · 한도를 검증한다)

class AiRegenerateRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    answer: dict[str, Any]
    issues: list[dict[str, Any]] = Field(default_factory=list, max_length=30)
    evidence: list[dict[str, Any]] = Field(default_factory=list, max_length=150)


class AiToolResultRequest(BaseModel):
    conversationId: str = Field(min_length=1, max_length=64)
    state: str = Field(min_length=1, max_length=600_000)
    callId: str = Field(min_length=1, max_length=128)
    toolResult: dict[str, Any]
    workflowObservation: dict[str, Any] | None = None   # workflow 에서 frontend 가 Tool 결과를 요약한 observation (원문 아님)



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


def _provider_report(external: ExternalProviders | None) -> dict[str, Any] | None:
    """health 에 노출하는 provider 신뢰 등급 (이름 · 등급 · 운영 가능 여부만, credential 은 없다)."""
    if external is None:
        return None
    return {k: provider_info(p).to_dict() for k, p in (("market", external.market), ("rates", external.rates), ("comparables", external.comparables), ("news", external.news)) if p is not None}


def create_app(settings: Settings | None = None, dart: DartHttpClient | None = None, cache: CorpCodeCache | None = None, financials: FinancialsService | None = None,
               store: FinancialStore | None = None, historical: HistoricalService | None = None, ai: AiGateway | None = None,
               embedder: EmbeddingProvider | None = None, disclosure_source: FilingsSource | None = None, reranker: Reranker | None = None,
               external: ExternalProviders | None = None) -> FastAPI:
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
    retriever = ingestion = disclosure_store = knowledge = None
    if store is not None and embedder is not None:
        disclosure_store = DisclosureStore(store.session_factory)
        if reranker is None:
            reranker = build_reranker(settings.reranker, settings.reranker_model, settings.reranker_api_key, settings.reranker_cache_dir or None)
        retriever = DisclosureRetriever(store.session_factory, embedder, min_score=settings.retrieval_min_score, reranker=reranker, rerank_candidates=settings.rerank_candidates, rerank_min_score=settings.rerank_min_score)
        ingestion = DisclosureIngestionService(disclosure_source or DartDisclosureSource(dart), embedder, disclosure_store)

        def _corp_name(code: str) -> str | None:
            return next((r.corp_name for r in cache.get() if r.corp_code == code), None)

        knowledge = KnowledgeService(embedder, disclosure_store, max_bytes=settings.max_upload_mb * 1024 * 1024, corp_name_lookup=_corp_name, max_documents=settings.max_user_documents)
    backend_tools = make_retrieval_tools(retriever) if retriever is not None else {}
    if external is None and settings.external_data:
        external = build_external(settings)   # provider 별 Key 가 없으면 그 Tool 만 unavailable
    install_redaction(settings.secrets())     # 로그에서 모든 credential 값을 가린다

    def _ticker(corp_code: str) -> TickerInfo | None:
        """corp code → 종목코드: 서버가 DART 기업 목록에서 찾는다 (모델 · frontend 가 정한 값이 아니다)."""
        try:
            rec = next((r for r in cache.get() if r.corp_code == corp_code), None)
        except DartApiError:
            raise ProviderError("unavailable", "The company directory (DART) is not available, so the ticker cannot be resolved.") from None
        return TickerInfo(rec.corp_name, (rec.stock_code or "").strip() or None) if rec else None
    if external is not None:
        backend_tools.update(make_external_tools(external, _ticker))
    if ai is None and settings.has_ai:
        ai = AiGateway(OpenAiProvider(settings.openai_api_key, settings.openai_model, settings.openai_base_url),
                       derive_secret(settings.ai_state_secret, settings.openai_api_key), max_tool_calls=settings.ai_max_tool_calls, backend_tools=backend_tools, agent_max_tool_calls=settings.ai_agent_max_tool_calls)
    snapshots = SnapshotStore(store.session_factory, settings.secrets()) if store is not None else None
    app = FastAPI(title="ValuFlow Backend", docs_url=None if settings.is_production else "/docs", redoc_url=None, openapi_url=None if settings.is_production else "/openapi.json")   # production 은 API 문서를 열지 않는다
    install_security(app, settings)

    @app.exception_handler(DartApiError)
    async def _dart_error(_: Request, exc: DartApiError) -> JSONResponse:
        return _error(exc.code, exc.message)

    @app.exception_handler(AiGatewayError)
    async def _ai_error(_: Request, exc: AiGatewayError) -> JSONResponse:
        return JSONResponse({"error": {"code": exc.code, "message": exc.message}}, status_code=exc.status)

    @app.exception_handler(PdfError)
    async def _pdf_error(_: Request, exc: PdfError) -> JSONResponse:
        return JSONResponse({"error": {"code": exc.code, "message": exc.message}}, status_code=exc.status)

    @app.exception_handler(ReportError)
    async def _report_error(_: Request, exc: ReportError) -> JSONResponse:
        return JSONResponse({"error": {"code": exc.code, "message": exc.message}}, status_code=exc.status)

    @app.exception_handler(SnapshotError)
    async def _snapshot_error(_: Request, exc: SnapshotError) -> JSONResponse:
        return JSONResponse({"error": {"code": exc.code, "message": exc.message}}, status_code=exc.status)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, __: RequestValidationError) -> JSONResponse:
        return _error("invalid-request", ERROR_MESSAGES["invalid-request"])

    @app.exception_handler(Exception)
    async def _unexpected(request: Request, exc: Exception) -> JSONResponse:
        logging.getLogger("valuflow.error").error("unhandled %s request_id=%s", type(exc).__name__, getattr(request.state, "request_id", "-"))   # 예외 종류만 남긴다 (본문 · traceback 에는 secret · 사용자 데이터가 섞일 수 있다)
        return _error("unknown", ERROR_MESSAGES["unknown"])  # 내부 오류 내용은 노출하지 않는다

    def _db_status() -> str:
        if store is None:
            return "not-configured"
        try:
            with store.session_factory() as s:
                s.execute(sql_text("SELECT 1"))
            return "ok"
        except Exception:  # noqa: BLE001
            return "unavailable"   # 연결 오류 내용(주소 · 계정)은 노출하지 않는다

    @app.get("/api/health")
    def health() -> dict[str, Any]:
        """운영 상태. 설정 여부(bool) · 상태 · 버전만 알려주고 credential 값 · 연결 문자열은 절대 싣지 않는다."""
        db = _db_status()
        from app.report.fonts import load_fonts
        return {"status": "ok" if db != "unavailable" else "degraded", "version": settings.app_version, "appEnv": settings.app_env, "database": db,
                "dartConfigured": settings.has_api_key, "databaseConfigured": historical.persistence_enabled, "aiConfigured": ai is not None,
                "disclosureSearchConfigured": retriever is not None, "ragAvailable": retriever is not None, "knowledgeUploadConfigured": knowledge is not None,
                "rerankerConfigured": reranker is not None, "persistenceAvailable": snapshots is not None and db == "ok",
                "reportService": {"available": True, "font": load_fonts().kind}, "publicDemo": True, "adminProtection": access_state(settings), "rateLimit": "disabled" if settings.rate_limit_disabled else "enabled",
                "externalToolsConfigured": external is not None, "externalProviders": _provider_report(external), "corpCodesFetchedAt": cache.fetched_at}

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

    def _require_knowledge() -> KnowledgeService:
        if knowledge is None:
            raise AiGatewayError("ai-not-configured", "문서 검색이 설정되어 있지 않습니다 (DATABASE_URL 과 OPENAI_API_KEY 가 필요합니다).", 503)
        return knowledge

    @app.post("/api/knowledge/documents")
    def upload_knowledge_document(
        file: UploadFile = File(...), title: str | None = Form(None), corpCode: str | None = Form(None), corpName: str | None = Form(None), documentType: str | None = Form(None),
        businessYear: str | None = Form(None), sourceName: str | None = Form(None), notes: str | None = Form(None),
    ) -> JSONResponse:
        """사용자 PDF 를 업로드한다 (backend 가 추출 · chunking · embedding). 같은 파일(SHA-256)을 다시 올리면 already-exists 로 기존 문서를 돌려준다."""
        svc = _require_knowledge()
        data = file.file.read(settings.max_upload_mb * 1024 * 1024 + 1)  # 한도를 넘는 본문은 끝까지 읽지 않는다
        meta = parse_meta(title, corpCode, corpName, documentType, businessYear, sourceName, notes)
        out = svc.upload_pdf(data, file.content_type, file.filename, meta)
        return JSONResponse(out, status_code=201 if out["status"] == "ingested" else 200)

    @app.get("/api/knowledge/documents")
    def list_knowledge_documents(sourceType: str | None = Query(None, pattern="^(opendart|user-upload)$"), corpCode: str | None = Query(None, pattern=r"^\d{8}$")) -> dict[str, Any]:
        return {"items": disclosure_store.list_knowledge(sourceType, corpCode) if disclosure_store is not None else []}

    @app.delete("/api/knowledge/documents/{document_id}")
    def delete_knowledge_document(document_id: int) -> dict[str, Any]:
        """문서와 chunk · embedding 을 함께 삭제한다."""
        if not _require_knowledge().delete(document_id):
            raise PdfError("document-not-found", "문서를 찾을 수 없습니다.", 404)
        return {"deleted": document_id}

    @app.post("/api/knowledge/documents/{document_id}/reindex")
    def reindex_knowledge_document(document_id: int) -> dict[str, Any]:
        """저장된 chunk 를 현재 embedding model 로 다시 embedding 한다."""
        doc = _require_knowledge().reindex(document_id)
        if doc is None:
            raise PdfError("document-not-found", "문서를 찾을 수 없습니다.", 404)
        return {"document": doc}

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
        return _require_ai().query(body.question, body.minimalContext, body.toolNames, body.workflow)

    @app.post("/api/ai/tool-result")
    def ai_tool_result(body: AiToolResultRequest) -> dict[str, Any]:
        """frontend 가 실행한 Tool 결과를 받아 모델을 이어서 호출한다."""
        result = _require_ai().tool_result(body.state, body.callId, body.toolResult, body.conversationId, body.workflowObservation)
        return result

    @app.post("/api/ai/regenerate")
    def ai_regenerate(body: AiRegenerateRequest) -> dict[str, Any]:
        """Grounding 검증에 실패한 workflow 답변을 위반 목록과 허용 근거만으로 1회 교정 재생성한다 (Tool 결과 원문 전체는 보내지 않는다)."""
        return _require_ai().regenerate(body.question, body.answer, body.issues, body.evidence)

    def _snapshots() -> SnapshotStore:
        if snapshots is None:
            raise SnapshotError("persistence-unavailable", "저장소(DATABASE_URL)가 설정되어 있지 않습니다.", 503)
        return snapshots

    @app.post("/api/analyses")
    def save_analysis(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        """검증된 AI 분석(claim · evidence 요약)을 저장한다. Tool 원문 · 문서 발췌는 저장하지 않는다."""
        return _snapshots().save_analysis(body)

    @app.get("/api/analyses")
    def list_analyses(corpCode: str | None = Query(None, pattern=r"^\d{8}$"), limit: int = Query(20, ge=1, le=50)) -> dict[str, Any]:
        return {"items": _snapshots().list_analyses(corpCode, limit)}

    @app.get("/api/analyses/{analysis_id}")
    def get_analysis(analysis_id: str = Path(..., pattern=r"^[A-Za-z0-9_.:-]{1,64}$")) -> dict[str, Any]:
        found = _snapshots().get_analysis(analysis_id)
        if found is None:
            raise SnapshotError("not-found", "저장된 분석을 찾을 수 없습니다.", 404)
        return found

    @app.post("/api/report-snapshots")
    def save_report_snapshot(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        """생성한 Report 의 ReportModel snapshot 을 저장한다 (과거 Report 를 같은 값으로 다시 열 수 있다)."""
        return _snapshots().save_report(body)

    @app.get("/api/report-snapshots")
    def list_report_snapshots(corpCode: str | None = Query(None, pattern=r"^\d{8}$"), limit: int = Query(20, ge=1, le=50)) -> dict[str, Any]:
        return {"items": _snapshots().list_reports(corpCode, limit)}

    @app.get("/api/report-snapshots/{report_id}")
    def get_report_snapshot(report_id: str = Path(..., pattern=r"^[A-Za-z0-9_.:-]{1,64}$")) -> dict[str, Any]:
        found = _snapshots().get_report(report_id)
        if found is None:
            raise SnapshotError("not-found", "저장된 Report 를 찾을 수 없습니다.", 404)
        return found

    @app.post("/api/report/pdf")
    def report_pdf(request: Request, render_model: dict[str, Any] = Body(...)) -> Response:
        """RenderModel(JSON)을 A4 PDF 로 그린다. 값은 계산하지 않고 표시 문자열을 그대로 그린다 (외부 API · LLM 호출 없음). 한글 폰트는 서버 폰트 전략(app/report/fonts.py)을 따른다."""
        if int(request.headers.get("content-length") or 0) > 8 * 1024 * 1024:
            raise ReportError("render-model-too-large", "Report 가 너무 큽니다.", 413)
        try:
            data, info = render_pdf(render_model)
        except ReportError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise ReportError("pdf-render-failed", "PDF 를 만들지 못했습니다.", 500) from exc   # 내부 오류 내용은 노출하지 않는다
        meta = render_model.get("meta", {})
        name = str(meta.get("filename") or "ValuFlow_Valuation_Report.pdf")
        ascii_name = "".join(c if c.isascii() and (c.isalnum() or c in "._-") else "_" for c in name) or "ValuFlow_Report.pdf"
        headers = {"Content-Disposition": f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(name)}", "X-Report-Font": info["font"], "X-Report-Pages": info["pages"], "Cache-Control": "no-store"}
        return Response(content=data, media_type="application/pdf", headers=headers)

    return app


def get_app() -> FastAPI:
    return create_app()
