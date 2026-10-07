"""PostgreSQL 스키마. 저장 대상: 기업 · 수집 메타 · Raw · 정규화 값 · 품질 · 미지원 결과.
저장하지 않는 것: HistoricalAnalysis / ForecastReference / ValuationResult / SensitivityResult (입력에서 다시 계산한다).
Raw 와 Normalized 는 서로 다른 테이블이며, 같은 fetch 에 매달려 있어 규칙이 바뀌면 Raw 에서 다시 정규화할 수 있다."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from datetime import date

from pgvector.sqlalchemy import Vector
from sqlalchemy import JSON, BigInteger, Boolean, Date, DateTime, Float, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

JsonType = JSON().with_variant(JSONB(), "postgresql")

NORMALIZED_VALUE_COLUMNS = [
    "revenue", "cogs", "gross_profit", "sga", "operating_profit", "net_income",
    "accounts_receivable", "inventory", "accounts_payable", "total_assets", "total_liabilities", "total_equity",
    "cash", "interest_bearing_debt", "lease_liabilities", "cfo", "ppe_acquisition", "intangible_acquisition", "depreciation_amortization",
]


class Base(DeclarativeBase):
    pass


class Company(Base):
    __tablename__ = "companies"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    corp_code: Mapped[str] = mapped_column(String(8), unique=True, nullable=False)
    stock_code: Mapped[str | None] = mapped_column(String(6), nullable=True)  # 비상장사는 없다
    corp_name: Mapped[str] = mapped_column(Text, nullable=False)
    corp_name_eng: Mapped[str | None] = mapped_column(Text, nullable=True)
    corp_class: Mapped[str | None] = mapped_column(String(1), nullable=True)
    source: Mapped[str] = mapped_column(String(32), nullable=False, server_default="OpenDART")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class FinancialFetch(Base):
    """수집 한 번의 기록. 새 수집은 새 row 를 남기고, 같은 key 의 최신 결과만 is_current 이다 (이력 보존)."""
    __tablename__ = "financial_fetches"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    report_code: Mapped[str] = mapped_column(String(8), nullable=False)
    basis_mode: Mapped[str] = mapped_column(String(16), nullable=False)       # auto | consolidated | separate (요청 방식)
    basis_requested: Mapped[str] = mapped_column(String(16), nullable=False)  # Consolidated | Separate
    basis_used: Mapped[str | None] = mapped_column(String(16), nullable=True)
    basis_fallback: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    requested_years: Mapped[list[int]] = mapped_column(JsonType, nullable=False)
    years_key: Mapped[str] = mapped_column(String(64), nullable=False)        # "2023,2024,2025" (조회 key)
    received_years: Mapped[list[int]] = mapped_column(JsonType, nullable=False)
    missing_years: Mapped[list[int]] = mapped_column(JsonType, nullable=False)
    raw_account_count: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)           # success | unsupported-industry | unsupported-structure | incomplete
    source: Mapped[str] = mapped_column(String(32), nullable=False, server_default="OpenDART")
    warnings: Mapped[list[str]] = mapped_column(JsonType, nullable=False)
    is_current: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    __table_args__ = (
        # 같은 회사 / 보고서 / 기준 요청 / 연도 조합의 current 는 하나뿐이다.
        Index("ux_fetch_current", "company_id", "report_code", "basis_mode", "years_key", unique=True, postgresql_where=text("is_current")),
        Index("ix_fetch_company", "company_id", "fetched_at"),
    )


class RawFinancialAccount(Base):
    """OpenDART 원본 보존 (정규화 규칙이 바뀌면 여기서 다시 정규화한다)."""
    __tablename__ = "raw_financial_accounts"
    id: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)
    fetch_id: Mapped[int] = mapped_column(ForeignKey("financial_fetches.id", ondelete="CASCADE"), nullable=False)
    fiscal_year: Mapped[int] = mapped_column(Integer, nullable=False)
    report_year: Mapped[int] = mapped_column(Integer, nullable=False)
    statement_type: Mapped[str] = mapped_column(String(8), nullable=False)
    raw_statement_type: Mapped[str] = mapped_column(String(8), nullable=False)
    basis: Mapped[str] = mapped_column(String(16), nullable=False)
    account_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    account_name: Mapped[str] = mapped_column(Text, nullable=False)
    account_detail: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    amount: Mapped[Any] = mapped_column(Numeric(38, 4), nullable=True)          # 빈 값은 0 이 아니라 NULL
    currency: Mapped[str | None] = mapped_column(String(8), nullable=True)
    unit: Mapped[str] = mapped_column(String(16), nullable=False, server_default="KRW")
    raw: Mapped[dict] = mapped_column(JsonType, nullable=False)
    __table_args__ = (
        # 중복 방지: fetch 단위로 격리된 (연도, 구분, 기준, 계정 id, 계정명, 세부) key
        Index("ux_raw_dedupe", "fetch_id", "fiscal_year", "raw_statement_type", "basis", text("coalesce(account_id, '')"), "account_name", "account_detail", unique=True),
    )


class NormalizedFinancial(Base):
    """HistoricalData 의 canonical 값. 한 row = (fetch, 회계연도). 값이 없으면 NULL (0 이 아님)."""
    __tablename__ = "normalized_financials"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    fetch_id: Mapped[int] = mapped_column(ForeignKey("financial_fetches.id", ondelete="CASCADE"), nullable=False)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    fiscal_year: Mapped[int] = mapped_column(Integer, nullable=False)
    basis: Mapped[str] = mapped_column(String(16), nullable=False)
    revenue: Mapped[float | None] = mapped_column(Float(53))
    cogs: Mapped[float | None] = mapped_column(Float(53))
    gross_profit: Mapped[float | None] = mapped_column(Float(53))
    sga: Mapped[float | None] = mapped_column(Float(53))
    operating_profit: Mapped[float | None] = mapped_column(Float(53))
    net_income: Mapped[float | None] = mapped_column(Float(53))
    accounts_receivable: Mapped[float | None] = mapped_column(Float(53))
    inventory: Mapped[float | None] = mapped_column(Float(53))
    accounts_payable: Mapped[float | None] = mapped_column(Float(53))
    total_assets: Mapped[float | None] = mapped_column(Float(53))
    total_liabilities: Mapped[float | None] = mapped_column(Float(53))
    total_equity: Mapped[float | None] = mapped_column(Float(53))
    cash: Mapped[float | None] = mapped_column(Float(53))
    interest_bearing_debt: Mapped[float | None] = mapped_column(Float(53))
    lease_liabilities: Mapped[float | None] = mapped_column(Float(53))
    cfo: Mapped[float | None] = mapped_column(Float(53))
    ppe_acquisition: Mapped[float | None] = mapped_column(Float(53))
    intangible_acquisition: Mapped[float | None] = mapped_column(Float(53))
    depreciation_amortization: Mapped[float | None] = mapped_column(Float(53))
    __table_args__ = (
        UniqueConstraint("fetch_id", "fiscal_year", name="ux_normalized_fetch_year"),
        Index("ix_normalized_company_year", "company_id", "fiscal_year"),
    )


class DataQualityRecord(Base):
    """정규화 품질: 필드별 상태 · warning · MappingTrace · 검증 결과. '이 숫자의 품질과 출처' 를 나중에 볼 수 있게 보존한다."""
    __tablename__ = "data_quality"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    fetch_id: Mapped[int] = mapped_column(ForeignKey("financial_fetches.id", ondelete="CASCADE"), nullable=False, unique=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    basis_requested: Mapped[str] = mapped_column(String(16), nullable=False)
    basis_used: Mapped[str] = mapped_column(String(16), nullable=False)
    basis_fallback: Mapped[bool] = mapped_column(Boolean, nullable=False)
    years_received: Mapped[list[int]] = mapped_column(JsonType, nullable=False)
    missing_years: Mapped[list[int]] = mapped_column(JsonType, nullable=False)
    fields: Mapped[dict] = mapped_column(JsonType, nullable=False)
    warnings: Mapped[list[str]] = mapped_column(JsonType, nullable=False)
    trace: Mapped[list[dict]] = mapped_column(JsonType, nullable=False)
    checks: Mapped[list[dict]] = mapped_column(JsonType, nullable=False)


class UnsupportedResult(Base):
    """현재 미지원 / 불완전한 결과. 같은 요청에서 매번 OpenDART 를 호출하지 않게 하며, refresh 로 재시도할 수 있다."""
    __tablename__ = "unsupported_results"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    fetch_id: Mapped[int] = mapped_column(ForeignKey("financial_fetches.id", ondelete="CASCADE"), nullable=False)
    report_code: Mapped[str] = mapped_column(String(8), nullable=False)
    basis_mode: Mapped[str] = mapped_column(String(16), nullable=False)
    years_key: Mapped[str] = mapped_column(String(64), nullable=False)
    code: Mapped[str] = mapped_column(String(32), nullable=False)             # unsupported-industry | unsupported-structure | incomplete
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    detail: Mapped[dict] = mapped_column(JsonType, nullable=False)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    __table_args__ = (UniqueConstraint("company_id", "report_code", "basis_mode", "years_key", name="ux_unsupported_key"),)


# ---- 공시 문서 Retrieval (STEP 08-3) ----
EMBEDDING_DIM = 1536  # text-embedding-3-small. 다른 차원의 모델을 쓰려면 새 migration 이 필요하다.


class DisclosureDocument(Base):
    """RAG 문서 한 건 (OpenDART 공시 또는 사용자 PDF). 같은 테이블을 공유하고 source_type 으로 구분한다.

    OpenDART: receipt_no(접수번호)가 문서 버전의 식별자이며 재수집 시 중복 ingestion 을 막는 기준이다.
    user-upload: file_hash(SHA-256)가 같은 파일의 중복 업로드를 막는 기준이다. corp_code 는 선택(산업 리포트처럼 기업과 무관한 문서는 NULL).
    report_type 은 문서 종류(document type)다: annual | half | quarterly (OpenDART) · industry-report | ir | ... (업로드).
    """
    __tablename__ = "disclosure_documents"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    receipt_no: Mapped[str | None] = mapped_column(String(14), unique=True, nullable=True)
    company_id: Mapped[int | None] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), nullable=True)
    corp_code: Mapped[str | None] = mapped_column(String(8), nullable=True)
    corp_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    report_name: Mapped[str] = mapped_column(Text, nullable=False)
    report_type: Mapped[str] = mapped_column(String(32), nullable=False)
    is_correction: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    filing_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    source_type: Mapped[str] = mapped_column(String(16), nullable=False, server_default="opendart")  # opendart | user-upload
    title: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    original_filename: Mapped[str | None] = mapped_column(Text, nullable=True)   # 표시용. 저장 경로에는 쓰지 않는다
    file_hash: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    uploaded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, server_default="ready")
    business_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source: Mapped[str] = mapped_column(String(32), nullable=False, server_default="OpenDART")
    url: Mapped[str | None] = mapped_column(Text, nullable=True)
    section_count: Mapped[int] = mapped_column(Integer, nullable=False)
    chunk_count: Mapped[int] = mapped_column(Integer, nullable=False)
    char_count: Mapped[int] = mapped_column(Integer, nullable=False)
    embedding_model: Mapped[str] = mapped_column(String(64), nullable=False)
    ingested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    __table_args__ = (Index("ix_disclosure_doc_lookup", "corp_code", "report_type", "business_year"), Index("ix_disclosure_doc_source", "source_type"))


class DisclosureChunk(Base):
    """문서의 chunk. section 구조를 보존하고, embedding 은 pgvector 로 저장한다 (정확 검색: 회사 단위로 걸러 낸 뒤 비교)."""
    __tablename__ = "disclosure_chunks"
    id: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("disclosure_documents.id", ondelete="CASCADE"), nullable=False)
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    section: Mapped[str] = mapped_column(Text, nullable=False)
    section_path: Mapped[list[str]] = mapped_column(JsonType, nullable=False)
    page_number: Mapped[int | None] = mapped_column(Integer, nullable=True)   # PDF 의 page (1부터)
    kind: Mapped[str] = mapped_column(String(8), nullable=False, server_default="text")  # text | table
    text: Mapped[str] = mapped_column(Text, nullable=False)
    char_count: Mapped[int] = mapped_column(Integer, nullable=False)
    embedding: Mapped[Any] = mapped_column(Vector(EMBEDDING_DIM), nullable=False)
    __table_args__ = (UniqueConstraint("document_id", "chunk_index", name="ux_chunk_doc_index"),)


class AiAnalysisRun(Base):
    """검증된 AI 분석(Deep Analysis) 결과. Report 에 쓸 claim · evidence 요약만 저장한다.
    저장하지 않는 것: Tool 결과 원문(raw ToolResult) · 문서 본문/발췌 · credential. 새로고침 뒤에도 Report 에 포함할 분석을 고를 수 있게 하는 최소 영속화다."""
    __tablename__ = "ai_analysis_runs"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)                 # client 의 analysisId (같은 id 를 다시 저장하면 갱신)
    corp_code: Mapped[str | None] = mapped_column(String(8), nullable=True)
    company_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    context_snapshot_id: Mapped[str] = mapped_column(String(32), nullable=False)
    workflow_type: Mapped[str] = mapped_column(String(48), nullable=False)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    grounding_summary: Mapped[dict[str, Any]] = mapped_column(JsonType, nullable=False)   # claim 수 · supported · 근거 수 (목록 표시용)
    payload: Mapped[dict[str, Any]] = mapped_column(JsonType, nullable=False)             # AiAnalysisInput (excerpt 제거)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    __table_args__ = (Index("ix_ai_analysis_corp", "corp_code", "created_at"),)


class ReportSnapshot(Base):
    """생성한 Report 의 ReportModel snapshot: 같은 snapshot 으로 Preview · PDF 를 다시 만들 수 있다 (과거 Report 재현)."""
    __tablename__ = "report_snapshots"
    report_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    corp_code: Mapped[str | None] = mapped_column(String(8), nullable=True)
    company_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    context_snapshot_id: Mapped[str] = mapped_column(String(32), nullable=False)
    schema_version: Mapped[str] = mapped_column(String(16), nullable=False)
    template_version: Mapped[str] = mapped_column(String(32), nullable=False)
    input_hash: Mapped[str | None] = mapped_column(String(32), nullable=True)
    model: Mapped[dict[str, Any]] = mapped_column(JsonType, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    __table_args__ = (Index("ix_report_snapshot_corp", "corp_code", "created_at"),)
