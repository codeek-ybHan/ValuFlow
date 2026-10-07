"""DB engine / session. DATABASE_URL 기반이며 특정 vendor 에 묶이지 않는다 (PostgreSQL)."""
from __future__ import annotations

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool

from app.config import Settings


def normalize_database_url(url: str) -> str:
    """postgres:// · postgresql:// 을 psycopg(v3) 드라이버 URL 로 맞춘다."""
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


def create_db_engine(settings: Settings) -> Engine:
    """serverless 를 고려한 engine: pool 크기를 제한하고(기본 2, overflow 0), db_pool=null 이면 pool 을 쓰지 않는다. connect 는 첫 사용 시점."""
    url = normalize_database_url(settings.database_url)
    if settings.db_pool == "null":
        return create_engine(url, poolclass=NullPool, pool_pre_ping=True)
    return create_engine(url, pool_size=settings.db_pool_size, max_overflow=settings.db_max_overflow, pool_pre_ping=True, pool_recycle=300)


def make_session_factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, expire_on_commit=False)
