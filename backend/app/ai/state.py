"""대화 상태 서명. backend 는 대화를 서버에 저장하지 않는다 (serverless 에서 여러 인스턴스가 처리해도 되도록).
상태는 HMAC 으로 서명한 토큰으로 frontend 가 들고 다니며, 변조하거나 만료되면 거부한다."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from typing import Any, Callable

from app.ai.errors import AiGatewayError, MESSAGES

MAX_STATE_BYTES = 400_000


def derive_secret(state_secret: str, api_key: str) -> bytes:
    """AI_STATE_SECRET 이 없으면 API Key 에서 파생한다 (같은 Key 를 쓰는 모든 인스턴스가 같은 값을 얻는다)."""
    return (state_secret or hashlib.sha256(b"valuflow-ai-state:" + api_key.encode()).hexdigest()).encode()


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def sign_state(payload: dict[str, Any], secret: bytes) -> str:
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()
    if len(raw) > MAX_STATE_BYTES:
        raise AiGatewayError("conversation-too-large", MESSAGES["conversation-too-large"], 413)
    body = _b64(raw)
    return f"{body}.{_b64(hmac.new(secret, body.encode(), hashlib.sha256).digest())}"


def verify_state(token: str, secret: bytes, ttl: int, now: Callable[[], float] = time.time) -> dict[str, Any]:
    try:
        body, sig = token.split(".", 1)
        expected = _b64(hmac.new(secret, body.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, expected):
            raise ValueError
        payload = json.loads(_unb64(body))
        if not isinstance(payload, dict) or payload.get("v") != 1:
            raise ValueError
    except (ValueError, TypeError, UnicodeError):
        raise AiGatewayError("invalid-state", MESSAGES["invalid-state"], 400) from None
    if now() - float(payload.get("created", 0)) > ttl:
        raise AiGatewayError("state-expired", MESSAGES["state-expired"], 410)
    return payload
