"""disclosure documents + chunks with pgvector embeddings

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-07
"""
import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import Vector
from sqlalchemy.dialects import postgresql

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

JSONT = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.create_table(
        "disclosure_documents",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("receipt_no", sa.String(14), nullable=False, unique=True),
        sa.Column("company_id", sa.Integer(), sa.ForeignKey("companies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("corp_code", sa.String(8), nullable=False),
        sa.Column("corp_name", sa.Text(), nullable=False),
        sa.Column("report_name", sa.Text(), nullable=False),
        sa.Column("report_type", sa.String(16), nullable=False),
        sa.Column("is_correction", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("filing_date", sa.Date(), nullable=False),
        sa.Column("business_year", sa.Integer(), nullable=True),
        sa.Column("source", sa.String(32), nullable=False, server_default="OpenDART"),
        sa.Column("url", sa.Text(), nullable=True),
        sa.Column("section_count", sa.Integer(), nullable=False),
        sa.Column("chunk_count", sa.Integer(), nullable=False),
        sa.Column("char_count", sa.Integer(), nullable=False),
        sa.Column("embedding_model", sa.String(64), nullable=False),
        sa.Column("ingested_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_disclosure_doc_lookup", "disclosure_documents", ["corp_code", "report_type", "business_year"])
    op.create_table(
        "disclosure_chunks",
        sa.Column("id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), primary_key=True, autoincrement=True),
        sa.Column("document_id", sa.Integer(), sa.ForeignKey("disclosure_documents.id", ondelete="CASCADE"), nullable=False),
        sa.Column("chunk_index", sa.Integer(), nullable=False),
        sa.Column("section", sa.Text(), nullable=False),
        sa.Column("section_path", JSONT, nullable=False),
        sa.Column("kind", sa.String(8), nullable=False, server_default="text"),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("char_count", sa.Integer(), nullable=False),
        sa.Column("embedding", Vector(1536), nullable=False),
        sa.UniqueConstraint("document_id", "chunk_index", name="ux_chunk_doc_index"),
    )


def downgrade() -> None:
    op.drop_table("disclosure_chunks")
    op.drop_table("disclosure_documents")
