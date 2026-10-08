"""disclosure_documents.owner_token_hash: 업로드한 사람만 자기 PDF 를 삭제할 수 있게 하는 삭제 토큰의 해시

공개 포트폴리오는 사용자 계정이 없어 소유권 모델이 없다. 업로드 때 서버가 추측할 수 없는 삭제 토큰을 한 번만 돌려주고(업로드한 브라우저가 보관),
서버에는 SHA-256 해시만 둔다. 토큰이 없는 기존 문서(NULL)는 관리자만 삭제할 수 있다.

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-08
"""
import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("disclosure_documents", sa.Column("owner_token_hash", sa.String(64), nullable=True))


def downgrade() -> None:
    op.drop_column("disclosure_documents", "owner_token_hash")
