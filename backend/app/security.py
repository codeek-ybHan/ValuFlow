"""공개 배포 보호: access token · rate limit · 요청 크기 제한 · request id / 구조화 access log · CORS.

원칙
  - 비용이 드는 · 쓰기 API 만 보호한다 (AI · 문서 업로드/삭제/재인덱싱 · 공시 수집 · Report PDF · 분석/Report 저장). 읽기 전용 조회(기업 검색 · Historical)는 공개다.
  - production 에서 ACCESS_TOKEN 이 설정되어 있지 않으면 보호 API 는 잠긴다 (실수로 열린 채 배포되지 않도록).
  - Rate limit 은 process 메모리 기준이다: 서버 instance 가 여러 개이거나 serverless 로 재시작되면 한도가 instance 마다 따로 적용된다 (docs/STEP10_production.md 의 한계 참고).
  - 로그에는 request id · method · route · status · 시간 · bucket 만 남긴다. 본문 · query · token · 문서 내용은 남기지 않는다.
"""
from __future__ import annotations

import hmac
import json
import logging
import re
import threading
import time
import uuid
from collections import defaultdict, deque
from typing import Awaitable, Callable

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

from app.config import Settings

ACCESS_HEADER = "X-ValuFlow-Access"
log = logging.getLogger("valuflow.access")

# bucket → (허용 횟수, 창(초)). 사람이 쓰는 데모 기준의 보수적 기본값이다.
LIMITS: dict[str, tuple[int, int]] = {"ai": (30, 60), "upload": (8, 600), "ingest": (6, 600), "report": (20, 60), "persist": (60, 60), "dart": (90, 60), "denied": (20, 600)}
MB = 1024 * 1024
DEFAULT_BODY_LIMIT = 1 * MB
RE_REQUEST_ID = re.compile(r"^[A-Za-z0-9_-]{8,64}$")


def classify(method: str, path: str) -> str | None:
    """보호 대상 API 의 bucket. None 이면 공개 조회다."""
    m = method.upper()
    if path.startswith("/api/ai/") and m == "POST":
        return "ai"
    if path.startswith("/api/knowledge/documents") and m in ("POST", "DELETE"):
        return "upload"
    if path.endswith("/disclosures/ingest") and m == "POST":
        return "ingest"
    if path == "/api/companies/refresh" and m == "POST":
        return "ingest"
    if path == "/api/report/pdf" and m == "POST":
        return "report"
    if path.startswith(("/api/analyses", "/api/report-snapshots")):
        return "persist"
    return None


def _public_dart(method: str, path: str) -> bool:
    return method.upper() == "GET" and path.startswith("/api/companies/") and path.count("/") >= 4


class RateLimiter:
    """sliding window (process 메모리). 시계는 테스트에서 바꿔 끼울 수 있다."""

    def __init__(self, clock: Callable[[], float] = time.monotonic):
        self._clock, self._hits, self._lock = clock, defaultdict(deque), threading.Lock()   # type: ignore[var-annotated]

    def blocked(self, bucket: str, client: str) -> int:
        """기록하지 않고 현재 막혀 있는지만 본다 (허용이면 0, 아니면 남은 초)."""
        limit, window = LIMITS[bucket]
        now = self._clock()
        with self._lock:
            q = self._hits[(bucket, client)]
            while q and q[0] <= now - window:
                q.popleft()
            return max(1, int(q[0] + window - now) + 1) if len(q) >= limit else 0

    def check(self, bucket: str, client: str) -> int:
        """허용이면 0, 아니면 다시 시도할 때까지의 초."""
        limit, window = LIMITS[bucket]
        now, q = self._clock(), None
        with self._lock:
            q = self._hits[(bucket, client)]
            while q and q[0] <= now - window:
                q.popleft()
            if len(q) >= limit:
                return max(1, int(q[0] + window - now) + 1)
            q.append(now)
            return 0


def body_limit(path: str, settings: Settings) -> int:
    if path.startswith("/api/knowledge/documents"):
        return settings.max_upload_mb * MB + MB      # multipart 오버헤드
    if path == "/api/report/pdf":
        return 8 * MB
    if path.startswith(("/api/analyses", "/api/report-snapshots")):
        return 2 * MB
    return DEFAULT_BODY_LIMIT


def _err(code: str, message: str, status: int, headers: dict[str, str] | None = None) -> JSONResponse:
    return JSONResponse({"error": {"code": code, "message": message}}, status_code=status, headers=headers)


def client_id(request: Request, settings: Settings) -> str:
    if settings.trust_proxy:
        fwd = request.headers.get("x-forwarded-for", "")
        if fwd.strip():
            return fwd.split(",")[0].strip()[:64]
    return request.client.host if request.client else "unknown"


def access_state(settings: Settings) -> str:
    """open(보호 없음) | token(token 필요) | locked(production 인데 token 이 없다)"""
    if settings.access_token:
        return "token"
    return "locked" if settings.is_production else "open"


def install_security(app: FastAPI, settings: Settings, limiter: RateLimiter | None = None) -> RateLimiter:
    limiter = limiter or RateLimiter()
    state = access_state(settings)

    if settings.cors_origins or not settings.is_production:
        origins = list(settings.cors_origins)
        regex = None if settings.is_production else r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$"
        app.add_middleware(CORSMiddleware, allow_origins=origins, allow_origin_regex=regex, allow_methods=["GET", "POST", "DELETE"],
                           allow_headers=["Content-Type", ACCESS_HEADER, "X-Request-ID"], expose_headers=["Content-Disposition", "X-Report-Pages", "X-Report-Font", "X-Request-ID"], max_age=600)

    @app.middleware("http")
    async def guard(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        started = time.perf_counter()
        rid = request.headers.get("x-request-id", "")
        rid = rid if RE_REQUEST_ID.match(rid) else uuid.uuid4().hex[:16]
        request.state.request_id = rid
        method, path = request.method, request.url.path
        bucket = classify(method, path)
        who = client_id(request, settings)
        denied: Response | None = None
        if not settings.rate_limit_disabled and bucket is None and _public_dart(method, path):
            bucket_rl = "dart"
        else:
            bucket_rl = bucket
        if path.startswith("/api/") and method in ("POST", "PUT", "PATCH"):
            declared = request.headers.get("content-length")
            if declared is not None and declared.isdigit() and int(declared) > body_limit(path, settings):
                denied = _err("payload-too-large", "요청이 너무 큽니다.", 413)
            elif declared is None and bucket is not None:
                denied = _err("length-required", "Content-Length 가 필요합니다.", 411)
        if denied is None and bucket is not None:
            if state == "locked":
                denied = _err("access-not-configured", "이 서버는 access token 이 설정되지 않아 이 기능이 잠겨 있습니다.", 403)
            elif state == "token":
                # 잘못된 token 을 반복해서 시도하는 client 는 (올바른 값을 넣어도) 잠시 막는다: 429 / 200 차이로 추측 결과를 알 수 없게 한다
                wait = 0 if settings.rate_limit_disabled else limiter.blocked("denied", who)
                if wait:
                    denied = _err("rate-limited", "시도가 너무 많습니다. 잠시 후 다시 시도하세요.", 429, {"Retry-After": str(wait)})
                elif not hmac.compare_digest(request.headers.get(ACCESS_HEADER, "").encode(), settings.access_token.encode()):
                    if not settings.rate_limit_disabled:
                        limiter.check("denied", who)
                    denied = _err("access-required", "Access key 가 필요합니다.", 401)
        if denied is None and bucket_rl is not None and not settings.rate_limit_disabled:
            wait = limiter.check(bucket_rl, who)
            if wait:
                denied = _err("rate-limited", "요청이 너무 많습니다. 잠시 후 다시 시도하세요.", 429, {"Retry-After": str(wait)})
        response = denied if denied is not None else await call_next(request)
        response.headers["X-Request-ID"] = rid
        route = request.scope.get("route")
        log.info(json.dumps({"requestId": rid, "method": method, "route": getattr(route, "path", path if denied is not None else "unmatched"), "status": response.status_code,
                             "durationMs": round((time.perf_counter() - started) * 1000, 1), "bucket": bucket_rl, "denied": denied is not None}, ensure_ascii=False))
        return response

    return limiter
