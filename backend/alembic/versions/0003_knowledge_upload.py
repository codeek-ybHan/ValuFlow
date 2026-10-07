"""knowledge documents: user PDF upload (source_type, file_hash, page_number) 를 같은 테이블에 추가

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-07
"""
import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None

T = "disclosure_documents"


def upgrade() -> None:
    with op.batch_alter_table(T) as b:
        b.alter_column("receipt_no", existing_type=sa.String(14), nullable=True)
        b.alter_column("company_id", existing_type=sa.Integer(), nullable=True)
        b.alter_column("corp_code", existing_type=sa.String(8), nullable=True)
        b.alter_column("corp_name", existing_type=sa.Text(), nullable=True)
        b.alter_column("report_type", existing_type=sa.String(16), type_=sa.String(32), existing_nullable=False)
        b.alter_column("filing_date", existing_type=sa.Date(), nullable=True)
        b.add_column(sa.Column("source_type", sa.String(16), nullable=False, server_default="opendart"))
        b.add_column(sa.Column("title", sa.Text(), nullable=True))
        b.add_column(sa.Column("source_name", sa.Text(), nullable=True))
        b.add_column(sa.Column("notes", sa.Text(), nullable=True))
        b.add_column(sa.Column("original_filename", sa.Text(), nullable=True))
        b.add_column(sa.Column("file_hash", sa.String(64), nullable=True))
        b.add_column(sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=True))
        b.add_column(sa.Column("status", sa.String(16), nullable=False, server_default="ready"))
        b.create_unique_constraint("uq_disclosure_documents_file_hash", ["file_hash"])
    op.create_index("ix_disclosure_doc_source", T, ["source_type"])
    op.add_column("disclosure_chunks", sa.Column("page_number", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("disclosure_chunks", "page_number")
    op.drop_index("ix_disclosure_doc_source", T)
    op.execute("DELETE FROM disclosure_documents WHERE source_type <> 'opendart'")
    with op.batch_alter_table(T) as b:
        b.drop_constraint("uq_disclosure_documents_file_hash", type_="unique")
        for c in ("status", "uploaded_at", "file_hash", "original_filename", "notes", "source_name", "title", "source_type"):
            b.drop_column(c)
        b.alter_column("filing_date", existing_type=sa.Date(), nullable=False)
        b.alter_column("report_type", existing_type=sa.String(32), type_=sa.String(16), existing_nullable=False)
        b.alter_column("corp_name", existing_type=sa.Text(), nullable=False)
        b.alter_column("corp_code", existing_type=sa.String(8), nullable=False)
        b.alter_column("company_id", existing_type=sa.Integer(), nullable=False)
        b.alter_column("receipt_no", existing_type=sa.String(14), nullable=False)
