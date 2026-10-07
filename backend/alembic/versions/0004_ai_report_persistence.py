"""ai_analysis_runs · report_snapshots: 검증된 AI 분석과 Report snapshot 의 최소 영속화

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-08
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None

Json = sa.JSON().with_variant(JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table(
        "ai_analysis_runs",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("corp_code", sa.String(8), nullable=True),
        sa.Column("company_name", sa.Text(), nullable=True),
        sa.Column("context_snapshot_id", sa.String(32), nullable=False),
        sa.Column("workflow_type", sa.String(48), nullable=False),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("grounding_summary", Json, nullable=False),
        sa.Column("payload", Json, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_ai_analysis_corp", "ai_analysis_runs", ["corp_code", "created_at"])
    op.create_table(
        "report_snapshots",
        sa.Column("report_id", sa.String(64), primary_key=True),
        sa.Column("corp_code", sa.String(8), nullable=True),
        sa.Column("company_name", sa.Text(), nullable=True),
        sa.Column("context_snapshot_id", sa.String(32), nullable=False),
        sa.Column("schema_version", sa.String(16), nullable=False),
        sa.Column("template_version", sa.String(32), nullable=False),
        sa.Column("input_hash", sa.String(32), nullable=True),
        sa.Column("model", Json, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_report_snapshot_corp", "report_snapshots", ["corp_code", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_report_snapshot_corp", "report_snapshots")
    op.drop_table("report_snapshots")
    op.drop_index("ix_ai_analysis_corp", "ai_analysis_runs")
    op.drop_table("ai_analysis_runs")
