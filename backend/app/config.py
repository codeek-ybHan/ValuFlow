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

    @property
    def has_api_key(self) -> bool:
        return bool(self.dart_api_key)


def load_settings(env: dict[str, str] | None = None, dotenv_path: Path | None = None) -> Settings:
    """환경변수 > backend/.env 순서로 읽는다."""
    source = os.environ if env is None else env
    dotenv = _read_dotenv(dotenv_path or Path(__file__).resolve().parent.parent / ".env") if env is None else {}
    key = source.get("DART_API_KEY") or dotenv.get("DART_API_KEY", "")
    return Settings(dart_api_key=key.strip(), dart_base_url=source.get("DART_BASE_URL") or DEFAULT_DART_BASE_URL)
