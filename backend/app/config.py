"""환경설정. API Key 는 환경변수(또는 backend/.env)에서만 읽고, 응답/로그에 절대 싣지 않는다."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_DART_BASE_URL = "https://opendart.fss.or.kr/api"


def _read_dotenv(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


@dataclass(frozen=True)
class Settings:
    # repr 에 노출되지 않도록 한다 (로그/디버그 출력 방어).
    dart_api_key: str = field(default="", repr=False)
    dart_base_url: str = DEFAULT_DART_BASE_URL
    timeout_seconds: float = 30.0
    # PostgreSQL (선택). 비어 있으면 DB 없이 동작한다 (조회할 때마다 OpenDART → 정규화).
    database_url: str = field(default="", repr=False)
    # serverless 에서 connection 이 무한히 늘지 않도록 pool 을 작게 제한한다. db_pool="null" 이면 pool 없이 요청마다 연결한다(외부 pooler 사용 시).
    db_pool_size: int = 2
    db_max_overflow: int = 0
    db_pool: str = "queue"
    # AI Analyst (LLM Gateway). Key 는 서버 환경변수에서만 읽고 응답 / 로그 / 오류에 싣지 않는다 (VITE_ 접두사 금지).
    openai_api_key: str = field(default="", repr=False)
    openai_model: str = "gpt-4.1-mini"
    openai_base_url: str = "https://api.openai.com/v1"
    ai_state_secret: str = field(default="", repr=False)
    ai_max_tool_calls: int = 5
    # 공시 Retrieval (embedding 도 backend 에서만 호출한다)
    embedding_model: str = "text-embedding-3-small"
    retrieval_min_score: float = 0.3

    @property
    def has_api_key(self) -> bool:
        return bool(self.dart_api_key)

    @property
    def has_ai(self) -> bool:
        return bool(self.openai_api_key)

    @property
    def has_database(self) -> bool:
        return bool(self.database_url)


def load_settings(env: dict[str, str] | None = None, dotenv_path: Path | None = None) -> Settings:
    """환경변수 > backend/.env 순서로 읽는다."""
    source = os.environ if env is None else env
    dotenv = _read_dotenv(dotenv_path or Path(__file__).resolve().parent.parent / ".env") if env is None else {}
    key = source.get("DART_API_KEY") or dotenv.get("DART_API_KEY", "")
    db_url = source.get("DATABASE_URL") or dotenv.get("DATABASE_URL", "")
    return Settings(
        dart_api_key=key.strip(), dart_base_url=source.get("DART_BASE_URL") or DEFAULT_DART_BASE_URL,
        database_url=db_url.strip(),
        openai_api_key=(source.get("OPENAI_API_KEY") or dotenv.get("OPENAI_API_KEY", "")).strip(),
        openai_model=source.get("OPENAI_MODEL") or dotenv.get("OPENAI_MODEL", "") or "gpt-4.1-mini",
        openai_base_url=(source.get("OPENAI_BASE_URL") or "https://api.openai.com/v1").rstrip("/"),
        ai_state_secret=(source.get("AI_STATE_SECRET") or dotenv.get("AI_STATE_SECRET", "")).strip(),
        ai_max_tool_calls=int(source.get("AI_MAX_TOOL_CALLS") or 5),
        embedding_model=source.get("OPENAI_EMBEDDING_MODEL") or dotenv.get("OPENAI_EMBEDDING_MODEL", "") or "text-embedding-3-small",
        retrieval_min_score=float(source.get("RETRIEVAL_MIN_SCORE") or 0.3),
        db_pool_size=int(source.get("DB_POOL_SIZE") or 2), db_max_overflow=int(source.get("DB_MAX_OVERFLOW") or 0), db_pool=(source.get("DB_POOL") or "queue").lower(),
    )
