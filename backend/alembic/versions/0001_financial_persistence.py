"""financial data persistence: companies, fetches, raw, normalized, quality, unsupported

Revision ID: 0001
Revises:
Create Date: 2026-10-07
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

JSONT = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")
VALUE_COLUMNS = [
    "revenue", "cogs", "gross_profit", "sga", "operating_profit", "net_income",
    "accounts_receivable", "inventory", "accounts_payable", "total_assets", "total_liabilities", "total_equity",
    "cash", "interest_bearing_debt", "lease_liabilities", "cfo", "ppe_acquisition", "intangible_acquisition", "depreciation_amortization",
]


def upgrade() -> None:
    op.create_table(
        "companies",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("corp_code", sa.String(8), nullable=False, unique=True),
        sa.Column("stock_code", sa.String(6), nullable=True),
        sa.Column("corp_name", sa.Text(), nullable=False),
        sa.Column("corp_name_eng", sa.Text(), nullable=True),
        sa.Column("corp_class", sa.String(1), nullable=True),
        sa.Column("source", sa.String(32), nullable=False, server_default="OpenDART"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_table(
        "financial_fetches",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("company_id", sa.Integer(), sa.ForeignKey("companies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("report_code", sa.String(8), nullable=False),
        sa.Column("basis_mode", sa.String(16), nullable=False),
        sa.Column("basis_requested", sa.String(16), nullable=False),
        sa.Column("basis_used", sa.String(16), nullable=True),
        sa.Column("basis_fallback", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("requested_years", JSONT, nullable=False),
        sa.Column("years_key", sa.String(64), nullable=False),
        sa.Column("received_years", JSONT, nullable=False),
        sa.Column("missing_years", JSONT, nullable=False),
        sa.Column("raw_account_count", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("source", sa.String(32), nullable=False, server_default="OpenDART"),
        sa.Column("warnings", JSONT, nullable=False),
        sa.Column("is_current", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ux_fetch_current", "financial_fetches", ["company_id", "report_code", "basis_mode", "years_key"], unique=True, postgresql_where=sa.text("is_current"))
    op.create_index("ix_fetch_company", "financial_fetches", ["company_id", "fetched_at"])
    op.create_table(
        "raw_financial_accounts",
        sa.Column("id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), primary_key=True, autoincrement=True),
        sa.Column("fetch_id", sa.Integer(), sa.ForeignKey("financial_fetches.id", ondelete="CASCADE"), nullable=False),
        sa.Column("fiscal_year", sa.Integer(), nullable=False),
        sa.Column("report_year", sa.Integer(), nullable=False),
        sa.Column("statement_type", sa.String(8), nullable=False),
        sa.Column("raw_statement_type", sa.String(8), nullable=False),
        sa.Column("basis", sa.String(16), nullable=False),
        sa.Column("account_id", sa.Text(), nullable=True),
        sa.Column("account_name", sa.Text(), nullable=False),
        sa.Column("account_detail", sa.Text(), nullable=False, server_default=""),
        sa.Column("amount", sa.Numeric(38, 4), nullable=True),
        sa.Column("currency", sa.String(8), nullable=True),
        sa.Column("unit", sa.String(16), nullable=False, server_default="KRW"),
        sa.Column("raw", JSONT, nullable=False),
    )
    op.create_index("ux_raw_dedupe", "raw_financial_accounts", ["fetch_id", "fiscal_year", "raw_statement_type", "basis", sa.text("coalesce(account_id, '')"), "account_name", "account_detail"], unique=True)
    op.create_table(
        "normalized_financials",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("fetch_id", sa.Integer(), sa.ForeignKey("financial_fetches.id", ondelete="CASCADE"), nullable=False),
        sa.Column("company_id", sa.Integer(), sa.ForeignKey("companies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("fiscal_year", sa.Integer(), nullable=False),
        sa.Column("basis", sa.String(16), nullable=False),
        *[sa.Column(c, sa.Float(53), nullable=True) for c in VALUE_COLUMNS],
        sa.UniqueConstraint("fetch_id", "fiscal_year", name="ux_normalized_fetch_year"),
    )
    op.create_index("ix_normalized_company_year", "normalized_financials", ["company_id", "fiscal_year"])
    op.create_table(
        "data_quality",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("fetch_id", sa.Integer(), sa.ForeignKey("financial_fetches.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("basis_requested", sa.String(16), nullable=False),
        sa.Column("basis_used", sa.String(16), nullable=False),
        sa.Column("basis_fallback", sa.Boolean(), nullable=False),
        sa.Column("years_received", JSONT, nullable=False),
        sa.Column("missing_years", JSONT, nullable=False),
        sa.Column("fields", JSONT, nullable=False),
        sa.Column("warnings", JSONT, nullable=False),
        sa.Column("trace", JSONT, nullable=False),
        sa.Column("checks", JSONT, nullable=False),
    )
    op.create_table(
        "unsupported_results",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("company_id", sa.Integer(), sa.ForeignKey("companies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("fetch_id", sa.Integer(), sa.ForeignKey("financial_fetches.id", ondelete="CASCADE"), nullable=False),
        sa.Column("report_code", sa.String(8), nullable=False),
        sa.Column("basis_mode", sa.String(16), nullable=False),
        sa.Column("years_key", sa.String(64), nullable=False),
        sa.Column("code", sa.String(32), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("detail", JSONT, nullable=False),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("company_id", "report_code", "basis_mode", "years_key", name="ux_unsupported_key"),
    )


def downgrade() -> None:
    for table in ("unsupported_results", "data_quality", "normalized_financials", "raw_financial_accounts", "financial_fetches", "companies"):
        op.drop_table(table)
