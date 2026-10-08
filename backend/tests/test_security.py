"""공개 포트폴리오 보호 — endpoint 정책(PUBLIC · PUBLIC_RATE_LIMITED · ADMIN_ONLY) · rate limit · 요청 크기 · CORS · 오류 노출 · health · 로그."""
from __future__ import annotations

import json
import logging

import pytest
from fastapi.testclient import TestClient

from app import security
from app.config import Settings, load_settings
from app.main import create_app

TOKEN = "demo-access-token-123"
SECRET_KEY = "SECRET-OPENDART-KEY-99999"
LIMIT_MSG = "Demo AI 사용 한도에 도달했습니다. 잠시 후 다시 시도해 주세요."


def make(**kw) -> TestClient:
    s = Settings(dart_api_key=SECRET_KEY, external_data=False, **kw)
    return TestClient(create_app(s), raise_server_exceptions=False)


def minimal_model():
    return {"version": "1.0", "meta": {"title": "t", "company": "c", "createdAt": "x", "filename": "r.pdf"}, "blocks": []}


def test_endpoint_access_policy_table():
    p = security.policy
    P, L, A = security.PUBLIC, security.PUBLIC_RATE_LIMITED, security.ADMIN_ONLY
    assert p("POST", "/api/ai/query") == (L, "ai")
    assert p("POST", "/api/ai/tool-result") == (L, "ai-step") and p("POST", "/api/ai/regenerate") == (L, "ai-step")
    assert p("POST", "/api/knowledge/documents") == (L, "upload")
    assert p("POST", "/api/report/pdf") == (L, "report-pdf")
    assert p("POST", "/api/knowledge/documents/3/reindex")[0] == A
    assert p("DELETE", "/api/knowledge/documents/3") == (L, "delete"), "삭제: 업로드한 사람의 삭제 토큰 또는 관리자 key — 권한은 handler 가 검사하고 시도 횟수는 제한한다"
    assert p("POST", "/api/companies/00126380/disclosures/ingest")[0] == A and p("POST", "/api/companies/refresh")[0] == A
    assert p("POST", "/api/companies/00126380/historical/renormalize")[0] == A and p("GET", "/api/companies/00126380/fetches")[0] == A
    for m, path in [("GET", "/api/analyses"), ("POST", "/api/analyses"), ("GET", "/api/analyses/x"), ("POST", "/api/report-snapshots"), ("GET", "/api/report-snapshots/x")]:
        assert p(m, path) == (A, "persist"), path
    for m, path in [("GET", "/api/health"), ("GET", "/api/companies"), ("GET", "/api/companies/00126380"), ("GET", "/api/knowledge/documents"), ("GET", "/api/companies/00126380/disclosures")]:
        assert p(m, path)[0] == P, path
    assert p("GET", "/api/companies/00126380/historical") == (P, "dart")


def test_production_without_admin_token_locks_only_admin_apis():
    client = make(app_env="production")
    for method, path in [("GET", "/api/analyses"), ("POST", "/api/report-snapshots"), ("POST", "/api/knowledge/documents/1/reindex"), ("POST", "/api/companies/refresh")]:
        r = client.request(method, path, json={} if method == "POST" else None)
        assert r.status_code == 403 and r.json()["error"]["code"] == "access-not-configured", (path, r.text)
    # 방문자 기능은 token 없이도 잠기지 않는다 (AI · 업로드는 설정이 없을 때 503 ai-not-configured 로 자기 사정을 알린다)
    assert client.post("/api/report/pdf", json=minimal_model()).status_code == 200
    assert client.post("/api/ai/query", json={"question": "q", "minimalContext": {}, "toolNames": []}).status_code in (422, 503)
    assert client.get("/api/health").status_code == 200


def test_public_features_need_no_key_even_when_admin_token_is_set():
    c = make(access_token=TOKEN, app_env="production")
    assert c.get("/api/health").status_code == 200
    assert c.get("/api/companies", params={"q": "삼성"}).status_code != 401
    assert c.post("/api/report/pdf", json=minimal_model()).status_code == 200            # Report PDF: key 없이
    assert c.get("/api/knowledge/documents").status_code == 200
    ai = c.post("/api/ai/query", json={"question": "q", "minimalContext": {}, "toolNames": []})
    assert ai.status_code not in (401, 403)                                              # AI: key 없이 (설정이 없으면 503/422)
    up = c.post("/api/knowledge/documents", files={"file": ("a.pdf", b"%PDF-1.4 x", "application/pdf")})
    assert up.status_code not in (401, 403)                                              # 업로드: key 없이


def test_admin_apis_require_token_and_accept_the_right_one():
    c = make(access_token=TOKEN)
    for method, path in [("GET", "/api/analyses"), ("GET", "/api/report-snapshots"), ("POST", "/api/analyses"), ("POST", "/api/report-snapshots"),
                         ("POST", "/api/knowledge/documents/1/reindex"), ("POST", "/api/companies/refresh")]:
        r = c.request(method, path, json={} if method == "POST" else None)
        assert r.status_code == 401 and r.json()["error"]["code"] == "access-required", (method, path, r.status_code)
        bad = c.request(method, path, json={} if method == "POST" else None, headers={security.ACCESS_HEADER: "wrong"})
        assert bad.status_code == 401, (method, path)
    ok = c.get("/api/analyses", headers={security.ACCESS_HEADER: TOKEN})
    assert ok.status_code != 401 and ok.status_code != 403, "올바른 admin key 는 통과 (저장소가 없으면 503)"
    assert ok.status_code == 503 and ok.json()["error"]["code"] == "persistence-unavailable"


def test_development_without_token_keeps_admin_open_and_health_describes_public_demo():
    body = make().get("/api/health").json()
    assert body["publicDemo"] is True and body["adminProtection"] == "open" and body["rateLimit"] == "enabled"
    assert "accessProtection" not in body
    assert make(access_token=TOKEN).get("/api/health").json()["adminProtection"] == "token"
    assert make(app_env="production").get("/api/health").json()["adminProtection"] == "locked"


def test_token_value_never_appears_in_responses_or_health():
    c = make(access_token=TOKEN, app_env="production")
    texts = [c.get("/api/health").text, c.get("/api/analyses").text, c.get("/api/analyses", headers={security.ACCESS_HEADER: "bad"}).text, c.post("/api/report/pdf", json=minimal_model()).text]
    assert all(TOKEN not in t and SECRET_KEY not in t for t in texts)
    assert TOKEN in Settings(access_token=TOKEN).secrets() and TOKEN not in repr(Settings(access_token=TOKEN))


@pytest.mark.real_limits
def test_report_pdf_rate_limit_returns_429_with_retry_after():
    c = make(access_token=TOKEN)
    limit = security.LIMITS["report-pdf"][0]
    codes = [c.post("/api/report/pdf", json=minimal_model()).status_code for _ in range(limit + 2)]
    assert codes[:limit] == [200] * limit and codes[limit:] == [429, 429]
    blocked = c.post("/api/report/pdf", json=minimal_model())
    assert blocked.json()["error"]["code"] == "rate-limited" and int(blocked.headers["retry-after"]) >= 1
    assert "PDF 내보내기 한도" in blocked.json()["error"]["message"]
    assert c.get("/api/health").status_code == 200, "다른 API 는 영향 없음"


@pytest.mark.real_limits
def test_ai_question_rate_limit_returns_429_with_user_message():
    c = make()
    limit = security.LIMITS["ai"][0]
    assert limit <= 10, "IP 당 시간당 질문 수는 소수여야 한다"
    body = {"question": "q", "minimalContext": {}, "toolNames": []}
    codes = [c.post("/api/ai/query", json=body).status_code for _ in range(limit + 1)]
    assert 429 not in codes[:limit] and codes[limit] == 429
    r = c.post("/api/ai/query", json=body)
    assert r.json()["error"]["message"] == LIMIT_MSG and r.json()["error"]["code"] == "rate-limited"
    assert c.post("/api/ai/tool-result", json={}).status_code != 429, "한 질문 안의 후속 왕복은 별도 bucket"


@pytest.mark.real_limits
def test_upload_rate_limit_returns_429():
    c = make()
    limit = security.LIMITS["upload"][0]
    send = lambda: c.post("/api/knowledge/documents", files={"file": ("a.pdf", b"%PDF-1.4 x", "application/pdf")}).status_code
    codes = [send() for _ in range(limit + 1)]
    assert 429 not in codes[:limit] and codes[limit] == 429


@pytest.mark.real_limits
def test_wrong_admin_token_attempts_are_throttled():
    c = make(access_token=TOKEN)
    codes = [c.get("/api/analyses", headers={security.ACCESS_HEADER: "x"}).status_code for _ in range(security.LIMITS["denied"][0] + 2)]
    assert codes[0] == 401 and codes[-1] == 429
    assert c.get("/api/analyses", headers={security.ACCESS_HEADER: TOKEN}).status_code == 429, "차단된 client 는 올바른 token 도 잠시 거부"


def test_rate_limiter_window_expires():
    now = [0.0]
    rl = security.RateLimiter(lambda: now[0])
    n = security.LIMITS["ai"][0]
    assert all(rl.check("ai", "a") == 0 for _ in range(n)) and rl.check("ai", "a") > 0
    assert rl.check("ai", "b") == 0, "client 별로 따로 센다"
    now[0] += security.LIMITS["ai"][1] + 1
    assert rl.check("ai", "a") == 0


def test_request_size_limits():
    c = make()
    big = {"version": "1.0", "meta": {}, "blocks": [], "pad": "x" * (9 * 1024 * 1024)}
    r = c.post("/api/report/pdf", json=big)
    assert r.status_code == 413 and r.json()["error"]["code"] == "payload-too-large"
    ai = c.post("/api/ai/query", content=b"{" + b" " * 1_100_000 + b"}", headers={"content-type": "application/json"})
    assert ai.status_code == 413
    pdf = c.post("/api/knowledge/documents", files={"file": ("a.pdf", b"%PDF-" + b"0" * (22 * 1024 * 1024), "application/pdf")})
    assert pdf.status_code == 413, "기본 업로드 한도는 20MB (+multipart 여유)"


def test_cors_production_only_configured_origin():
    prod = make(app_env="production", cors_origins=("https://valuflow.example.com",))
    ok = prod.options("/api/health", headers={"Origin": "https://valuflow.example.com", "Access-Control-Request-Method": "GET"})
    assert ok.headers.get("access-control-allow-origin") == "https://valuflow.example.com"
    bad = prod.options("/api/health", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"})
    assert "access-control-allow-origin" not in bad.headers
    none = make(app_env="production")
    assert "access-control-allow-origin" not in none.options("/api/health", headers={"Origin": "https://x.example", "Access-Control-Request-Method": "GET"}).headers
    dev = make()
    assert dev.options("/api/health", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"}).headers.get("access-control-allow-origin") == "http://localhost:5173"
    assert "access-control-allow-origin" not in dev.options("/api/health", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"}).headers


def test_api_docs_closed_in_production():
    assert make(app_env="production").get("/docs").status_code == 404 and make(app_env="production").get("/openapi.json").status_code == 404
    assert make().get("/docs").status_code == 200


def test_internal_errors_are_not_exposed_and_log_has_no_secrets(caplog):
    s = Settings(dart_api_key=SECRET_KEY, external_data=False)
    app = create_app(s)

    @app.get("/boom")
    def boom():
        raise RuntimeError(f"db password=hunter2 key={SECRET_KEY} /Users/x/secret.py SELECT * FROM t")

    c = TestClient(app, raise_server_exceptions=False)
    with caplog.at_level(logging.INFO):
        r = c.get("/boom")
    assert r.status_code == 502 or r.status_code >= 500
    for leak in ("hunter2", SECRET_KEY, "/Users/x", "SELECT", "Traceback", "RuntimeError"):
        assert leak not in r.text, leak
    assert SECRET_KEY not in caplog.text and "hunter2" not in caplog.text, "로그에도 secret 이 없다"
    assert "request_id=" in caplog.text


def test_structured_access_log_contains_metadata_only(caplog):
    c = make(access_token=TOKEN)
    with caplog.at_level(logging.INFO, logger="valuflow.access"):
        r = c.post("/api/report/pdf?secret=abc", json={"version": "1.0", "meta": {"company": "PRIVATE-NAME"}, "blocks": []}, headers={"X-Request-ID": "req-12345678"})
    assert r.headers["x-request-id"] == "req-12345678"
    rec = [json.loads(x.message) for x in caplog.records if x.name == "valuflow.access"][-1]
    assert rec["requestId"] == "req-12345678" and rec["route"] == "/api/report/pdf" and rec["bucket"] == "report-pdf" and rec["policy"] == "PUBLIC_RATE_LIMITED"
    assert rec["status"] in (200, 422) and rec["durationMs"] >= 0
    assert "PRIVATE-NAME" not in caplog.text and TOKEN not in caplog.text and "secret=abc" not in caplog.text
    bad = c.get("/api/health", headers={"X-Request-ID": "bad id!"})
    assert bad.headers["x-request-id"] != "bad id!" and len(bad.headers["x-request-id"]) == 16


def test_health_reports_status_without_credentials():
    body = make(app_env="production", access_token=TOKEN, app_version="9.9.9").get("/api/health").json()
    assert body["status"] == "ok" and body["version"] == "9.9.9" and body["appEnv"] == "production" and body["database"] == "not-configured"
    assert body["dartConfigured"] is True and body["aiConfigured"] is False and body["ragAvailable"] is False and body["persistenceAvailable"] is False
    assert body["reportService"]["available"] is True and body["reportService"]["font"] in ("ttf-embedded", "cid-fallback")
    dump = json.dumps(body)
    assert SECRET_KEY not in dump and TOKEN not in dump


def test_settings_production_defaults():
    prod = load_settings({"APP_ENV": "production", "CORS_ORIGINS": "https://a.example/, https://b.example"})
    assert prod.reranker == "none", "production 기본은 Hybrid (로컬 reranker 모델을 쓰지 않는다)"
    assert prod.cors_origins == ("https://a.example", "https://b.example")
    assert load_settings({"APP_ENV": "production", "RERANKER": "cohere"}).reranker == "cohere", "명시하면 따른다"
    assert load_settings({}).reranker == "auto"
    assert load_settings({"ACCESS_TOKEN": " t "}).access_token == "t"
    assert load_settings({}).max_upload_mb == 20 and load_settings({}).max_user_documents == 30


def test_denied_responses_carry_cors_headers_so_the_browser_shows_the_real_message():
    """guard 가 만든 거부 응답(401 · 413 · 429)에도 CORS 헤더가 있어야 한다. 없으면 브라우저는 응답을 숨기고 "서버에 연결할 수 없습니다" 로만 보인다 (삭제 · 한도 안내가 사라진다)."""
    origin = "https://valuflow.example.com"
    c = make(app_env="production", access_token=TOKEN, cors_origins=(origin,))
    h = {"Origin": origin}
    denied = c.post("/api/knowledge/documents/1/reindex", headers=h)
    assert denied.status_code == 401 and denied.json()["error"]["code"] == "access-required"
    assert denied.headers.get("access-control-allow-origin") == origin, "관리자 전용 거부(401)에도 CORS 헤더"
    big = c.post("/api/report/pdf", json={"version": "1.0", "meta": {}, "blocks": [], "pad": "x" * (9 * 1024 * 1024)}, headers=h)
    assert big.status_code == 413 and big.headers.get("access-control-allow-origin") == origin
    assert c.get("/api/analyses", headers=h).headers.get("access-control-allow-origin") == origin
    assert "access-control-allow-origin" not in c.post("/api/knowledge/documents/1/reindex", headers={"Origin": "https://evil.example"}).headers, "허용하지 않은 origin 은 그대로 막힌다"
    pre_token = c.options("/api/knowledge/documents/1", headers={**h, "Access-Control-Request-Method": "DELETE", "Access-Control-Request-Headers": "x-valuflow-delete-token"})
    assert pre_token.status_code == 200 and "x-valuflow-delete-token" in pre_token.headers.get("access-control-allow-headers", "").lower()
    pre = c.options("/api/knowledge/documents/1", headers={**h, "Access-Control-Request-Method": "DELETE"})
    assert pre.status_code == 200 and pre.headers["access-control-allow-origin"] == origin


@pytest.mark.real_limits
def test_rate_limited_429_is_readable_cross_origin_with_retry_after():
    origin = "https://valuflow.example.com"
    c = make(app_env="production", cors_origins=(origin,))
    h = {"Origin": origin}
    for _ in range(security.LIMITS["report-pdf"][0]):
        assert c.post("/api/report/pdf", json=minimal_model(), headers=h).status_code == 200
    r = c.post("/api/report/pdf", json=minimal_model(), headers=h)
    assert r.status_code == 429 and r.headers.get("access-control-allow-origin") == origin
    assert "retry-after" in r.headers and "retry-after" in r.headers.get("access-control-expose-headers", "").lower()
