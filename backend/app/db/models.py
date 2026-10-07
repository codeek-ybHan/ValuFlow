"""PostgreSQL 스키마. 저장 대상: 기업 · 수집 메타 · Raw · 정규화 값 · 품질 · 미지원 결과.
저장하지 않는 것: HistoricalAnalysis / ForecastReference / ValuationResult / SensitivityResult (입력에서 다시 계산한다).
Raw 와 Normalized 는 서로 다른 테이블이며, 같은 fetch 에 매달려 있어 규칙이 바뀌면 Raw 에서 다시 정규화할 수 있다."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, BigInteger, Boolean, DateTime, Float, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint, func, text
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
