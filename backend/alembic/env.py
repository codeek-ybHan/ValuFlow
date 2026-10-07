"""Alembic 환경. DATABASE_URL(환경변수 > backend/.env)을 사용하고, 테스트에서는 config 의 sqlalchemy.url 로 덮어쓸 수 있다."""
from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine, pool

from app.config import load_settings
from app.db.models import Base
from app.db.session import normalize_database_url

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name, disable_existing_loggers=False)
target_metadata = Base.metadata


def _url() -> str:
    url = config.get_main_option("sqlalchemy.url") or load_settings().database_url
    if not url:
        raise RuntimeError("DATABASE_URL 이 설정되어 있지 않습니다. 예: postgresql://user:pass@localhost:5432/valuflow")
    return normalize_database_url(url)


def run_migrations_offline() -> None:
    context.configure(url=_url(), target_metadata=target_metadata, literal_binds=True, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = create_engine(_url(), poolclass=pool.NullPool)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
