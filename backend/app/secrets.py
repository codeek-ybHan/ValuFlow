"""Credential 보호: 설정된 모든 secret 값을 로그에서 가린다 (응답 · Audit 에는 애초에 싣지 않지만, 예외 메시지나 URL 로 새는 경우의 마지막 방어선).
모든 credential 은 backend 환경변수에만 있고, frontend bundle 에는 들어가지 않는다 (VITE_ 접두사 금지)."""
from __future__ import annotations

import logging

MASK = "***"
MIN_LEN = 6   # 너무 짧은 값은 일반 단어를 가리게 되므로 제외한다


class RedactingFilter(logging.Filter):
    def __init__(self, secrets_: list[str]):
        super().__init__()
        self._secrets = sorted({s for s in secrets_ if s and len(s) >= MIN_LEN}, key=len, reverse=True)

    def filter(self, record: logging.LogRecord) -> bool:
        if not self._secrets:
            return True
        msg = record.getMessage()
        if any(s in msg for s in self._secrets):
            for s in self._secrets:
                msg = msg.replace(s, MASK)
            record.msg, record.args = msg, None
        if record.exc_info or record.exc_text:   # traceback 에 secret 이 섞일 수 있으므로 예외 본문은 남기지 않는다
            if record.exc_info and any(s in str(record.exc_info[1]) for s in self._secrets):
                record.exc_info = None
                record.exc_text = None
        return True


_installed: list[tuple[object, RedactingFilter]] = []


def install_redaction(secrets_: list[str], logger_names: tuple[str, ...] = ("valuflow", "uvicorn", "uvicorn.error", "httpx", "httpcore", "")) -> RedactingFilter:
    """주어진 secret 을 가리는 filter 를 logger · handler 에 건다. 다시 호출하면 이전 filter 를 교체한다 (중복 누적 없음)."""
    for target, old in _installed:
        target.removeFilter(old)  # type: ignore[attr-defined]
    _installed.clear()
    f = RedactingFilter(secrets_)
    for name in logger_names:
        lg = logging.getLogger(name)
        for target in (lg, *lg.handlers):   # handler 에 걸어야 하위 logger 의 record 도 거른다
            target.addFilter(f)
            _installed.append((target, f))
    return f
