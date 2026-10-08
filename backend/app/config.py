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
    ai_agent_max_tool_calls: int = 10   # Agent workflow 의 Tool 호출 상한 (일반 질문은 ai_max_tool_calls)
    # 공시 Retrieval (embedding 도 backend 에서만 호출한다)
    embedding_model: str = "text-embedding-3-small"
    retrieval_min_score: float = 0.3
    # Reranker: none | cross-encoder (로컬 fastembed) | cohere | auto (fastembed 가 설치되어 있으면 cross-encoder)
    reranker: str = "none"
    reranker_model: str = ""
    reranker_api_key: str = field(default="", repr=False)     # RERANKER=cohere 일 때만 (예전 이름 COHERE_API_KEY 도 읽는다)
    # 외부 데이터 provider 선택 + credential. 기본 provider(yahoo · google)는 Key 가 필요 없다. Key 가 필요한 provider 를 고르고 Key 가 없으면 그 Tool 만 unavailable 이다.
    market_data_provider: str = "yahoo"
    market_data_api_key: str = field(default="", repr=False)
    news_provider: str = "google"
    news_api_key: str = field(default="", repr=False)
    rerank_candidates: int = 15
    rerank_min_score: float | None = None
    reranker_cache_dir: str = ""
    # 외부 데이터 Tool (시세 · 금리 · 비교기업 · 뉴스). 키가 필요 없는 provider 를 쓰며, TTL 은 데이터 성격별로 다르다 (초).
    external_data: bool = False
    # development(기본): 비공식 provider(Yahoo · Google News)를 fallback 으로 허용 · production: development 등급 provider 는 unavailable
    app_env: str = "development"
    market_ttl: int = 300
    fundamentals_ttl: int = 86400
    rate_ttl: int = 86400
    news_ttl: int = 900
    # 사용자 PDF 업로드
    max_upload_mb: int = 20
    max_user_documents: int = 30      # 공개 데모: 업로드된 사용자 PDF 총 개수 상한 (사용자별 분리가 없으므로 저장소 폭주를 막는다)
    # 공개 포트폴리오: 핵심 기능은 access key 없이 쓰고(비용이 드는 기능은 IP rate limit), ADMIN_ONLY(저장/조회 persistence · 문서 삭제/재인덱싱 · 공시 수집 · 진단)만 이 token 이 필요하다.
    # production 에서 ACCESS_TOKEN 이 없으면 ADMIN_ONLY API 는 잠긴다. development 는 token 이 없으면 열려 있다.
    access_token: str = field(default="", repr=False)
    # production frontend origin (쉼표 구분). production 에서 비어 있으면 CORS 를 열지 않는다 (same-origin 만). development 는 localhost 를 허용한다.
    cors_origins: tuple[str, ...] = ()
    trust_proxy: bool = False            # True 면 X-Forwarded-For 첫 값을 client 로 본다 (신뢰하는 reverse proxy 뒤에서만)
    rate_limit_disabled: bool = False
    app_version: str = "1.0.0"

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    def secrets(self) -> list[str]:
        """로그에서 가릴 모든 credential 값 (DB URL 은 비밀번호를 포함한다)."""
        return [v for v in (self.dart_api_key, self.openai_api_key, self.ai_state_secret, self.database_url, self.reranker_api_key, self.market_data_api_key, self.news_api_key, self.access_token) if v]

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
    app_env = (source.get("APP_ENV") or dotenv.get("APP_ENV", "") or "development").lower()
    origins = tuple(o.strip().rstrip("/") for o in (source.get("CORS_ORIGINS") or dotenv.get("CORS_ORIGINS", "")).split(",") if o.strip())
    return Settings(
        access_token=(source.get("ACCESS_TOKEN") or dotenv.get("ACCESS_TOKEN", "")).strip(), cors_origins=origins,
        trust_proxy=(source.get("TRUST_PROXY") or "").lower() in ("1", "true", "yes"), rate_limit_disabled=(source.get("RATE_LIMIT_DISABLED") or "").lower() in ("1", "true", "yes"),
        app_version=source.get("APP_VERSION") or "1.0.0",
        dart_api_key=key.strip(), dart_base_url=source.get("DART_BASE_URL") or DEFAULT_DART_BASE_URL,
        database_url=db_url.strip(),
        openai_api_key=(source.get("OPENAI_API_KEY") or dotenv.get("OPENAI_API_KEY", "")).strip(),
        openai_model=source.get("OPENAI_MODEL") or dotenv.get("OPENAI_MODEL", "") or "gpt-4.1-mini",
        openai_base_url=(source.get("OPENAI_BASE_URL") or "https://api.openai.com/v1").rstrip("/"),
        ai_state_secret=(source.get("AI_STATE_SECRET") or dotenv.get("AI_STATE_SECRET", "")).strip(),
        ai_max_tool_calls=int(source.get("AI_MAX_TOOL_CALLS") or 5),
        ai_agent_max_tool_calls=int(source.get("AI_AGENT_MAX_TOOL_CALLS") or 10),
        embedding_model=source.get("OPENAI_EMBEDDING_MODEL") or dotenv.get("OPENAI_EMBEDDING_MODEL", "") or "text-embedding-3-small",
        retrieval_min_score=float(source.get("RETRIEVAL_MIN_SCORE") or 0.3),
        reranker=(source.get("RERANKER") or dotenv.get("RERANKER", "") or ("none" if app_env == "production" else "auto")).lower(),   # production 기본은 Hybrid(reranker 없음): 로컬 모델(~1.1GB)은 배포에 부적합하고 STEP 08 평가에서도 Hybrid 가 충분했다
        reranker_model=source.get("RERANKER_MODEL") or dotenv.get("RERANKER_MODEL", ""),
        reranker_api_key=(source.get("RERANKER_API_KEY") or source.get("COHERE_API_KEY") or dotenv.get("RERANKER_API_KEY", "") or dotenv.get("COHERE_API_KEY", "")).strip(),
        market_data_provider=(source.get("MARKET_DATA_PROVIDER") or dotenv.get("MARKET_DATA_PROVIDER", "") or "yahoo").lower(),
        market_data_api_key=(source.get("MARKET_DATA_API_KEY") or dotenv.get("MARKET_DATA_API_KEY", "")).strip(),
        news_provider=(source.get("NEWS_PROVIDER") or dotenv.get("NEWS_PROVIDER", "") or "google").lower(),
        news_api_key=(source.get("NEWS_API_KEY") or dotenv.get("NEWS_API_KEY", "")).strip(),
        rerank_candidates=int(source.get("RERANK_CANDIDATES") or 15),
        rerank_min_score=float(source["RERANK_MIN_SCORE"]) if source.get("RERANK_MIN_SCORE") else None,
        reranker_cache_dir=source.get("RERANKER_CACHE_DIR") or dotenv.get("RERANKER_CACHE_DIR", ""),
        max_upload_mb=int(source.get("MAX_UPLOAD_MB") or 20), max_user_documents=int(source.get("MAX_USER_DOCUMENTS") or 30),
        app_env=app_env,
        external_data=(source.get("EXTERNAL_DATA") or dotenv.get("EXTERNAL_DATA", "") or "true").lower() not in ("0", "false", "no", "off"),
        market_ttl=int(source.get("MARKET_TTL_SECONDS") or 300), fundamentals_ttl=int(source.get("FUNDAMENTALS_TTL_SECONDS") or 86400),
        rate_ttl=int(source.get("RATE_TTL_SECONDS") or 86400), news_ttl=int(source.get("NEWS_TTL_SECONDS") or 900),
        db_pool_size=int(source.get("DB_POOL_SIZE") or 2), db_max_overflow=int(source.get("DB_MAX_OVERFLOW") or 0), db_pool=(source.get("DB_POOL") or "queue").lower(),
    )
