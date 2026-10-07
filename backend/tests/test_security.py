"""STEP 10: 공개 배포 보호 — access token · rate limit · 요청 크기 · CORS · 오류 노출 · health · 로그."""
from __future__ import annotations

import io
import json
import logging

import pytest
from fastapi.testclient import TestClient

from app import security
from app.config import Settings, load_settings
from app.main import create_app

TOKEN = "demo-access-token-123"
SECRET_KEY = "SECRET-OPENDART-KEY-99999"


def make(**kw) -> TestClient:
    s = Settings(dart_api_key=SECRET_KEY, external_data=False, **kw)
    return TestClient(create_app(s), raise_server_exceptions=False)


def minimal_model():
    return {"version": "1.0", "meta": {"title": "t", "company": "c", "createdAt": "x", "filename": "r.pdf"}, "blocks": []}


def test_classify_protects_only_cost_and_write_endpoints():
    c = security.classify
    assert c("POST", "/api/ai/query") == "ai" and c("POST", "/api/ai/regenerate") == "ai"
    assert c("POST", "/api/knowledge/documents") == "upload" and c("DELETE", "/api/knowledge/documents/3") == "upload" and c("POST", "/api/knowledge/documents/3/reindex") == "upload"
    assert c("POST", "/api/companies/00126380/disclosures/ingest") == "ingest" and c("POST", "/api/companies/refresh") == "ingest"
    assert c("POST", "/api/report/pdf") == "report"
    assert c("GET", "/api/analyses") == "persist" and c("POST", "/api/report-snapshots") == "persist"
    for m, p in [("GET", "/api/health"), ("GET", "/api/companies"), ("GET", "/api/companies/00126380/historical"), ("GET", "/api/knowledge/documents")]:
        assert c(m, p) is None, p


def test_production_without_token_locks_protected_apis_but_not_public_reads():
    client = make(app_env="production")
    for method, path in [("POST", "/api/report/pdf"), ("POST", "/api/ai/query"), ("POST", "/api/knowledge/documents"), ("GET", "/api/analyses")]:
        r = client.request(method, path, json={} if method == "POST" and "documents" not in path else None, files={"file": ("a.pdf", b"x", "application/pdf")} if "documents" in path else None)
        assert r.status_code == 403 and r.json()["error"]["code"] == "access-not-configured", (path, r.text)
    assert client.get("/api/health").status_code == 200
    assert client.get("/api/health").json()["accessProtection"] == "locked"


def test_development_without_token_is_open_and_with_token_is_enforced():
    open_client = make()
    assert open_client.post("/api/report/pdf", json=minimal_model()).status_code == 200
    assert open_client.get("/api/health").json()["accessProtection"] == "open"
    guarded = make(access_token=TOKEN)
    assert guarded.post("/api/report/pdf", json=minimal_model()).status_code == 401
    r = guarded.post("/api/report/pdf", json=minimal_model(), headers={security.ACCESS_HEADER: "wrong"})
    assert r.status_code == 401 and r.json()["error"]["code"] == "access-required"
    ok = guarded.post("/api/report/pdf", json=minimal_model(), headers={security.ACCESS_HEADER: TOKEN})
    assert ok.status_code == 200 and ok.content.startswith(b"%PDF")
    assert guarded.get("/api/health").json()["accessProtection"] == "token"


def test_token_value_never_appears_in_responses_or_health():
    c = make(access_token=TOKEN, app_env="production")
    texts = [c.get("/api/health").text, c.post("/api/report/pdf", json=minimal_model()).text, c.post("/api/report/pdf", json=minimal_model(), headers={security.ACCESS_HEADER: "bad"}).text]
    assert all(TOKEN not in t and SECRET_KEY not in t for t in texts)
    assert TOKEN in Settings(access_token=TOKEN).secrets() and TOKEN not in repr(Settings(access_token=TOKEN))


@pytest.mark.real_limits
def test_rate_limit_blocks_repeated_calls_and_reports_retry_after():
    c = make(access_token=TOKEN)
    h = {security.ACCESS_HEADER: TOKEN}
    limit = security.LIMITS["report"][0]
    codes = [c.post("/api/report/pdf", json=minimal_model(), headers=h).status_code for _ in range(limit + 2)]
    assert codes[:limit] == [200] * limit and codes[limit:] == [429, 429]
    blocked = c.post("/api/report/pdf", json=minimal_model(), headers=h)
    assert blocked.json()["error"]["code"] == "rate-limited" and int(blocked.headers["retry-after"]) >= 1
    assert c.get("/api/health").status_code == 200, "다른 API 는 영향 없음"


@pytest.mark.real_limits
def test_wrong_token_attempts_are_throttled():
    c = make(access_token=TOKEN)
    codes = [c.post("/api/report/pdf", json=minimal_model(), headers={security.ACCESS_HEADER: "x"}).status_code for _ in range(security.LIMITS["denied"][0] + 2)]
    assert codes[0] == 401 and codes[-1] == 429
    assert c.post("/api/report/pdf", json=minimal_model(), headers={security.ACCESS_HEADER: TOKEN}).status_code == 429, "차단된 client 는 올바른 token 도 잠시 거부"


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
    pdf = c.post("/api/knowledge/documents", files={"file": ("a.pdf", b"%PDF-" + b"0" * (21 * 1024 * 1024), "application/pdf")})
    assert pdf.status_code == 413


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
        r = c.post("/api/report/pdf?secret=abc", json={"version": "1.0", "meta": {"company": "PRIVATE-NAME"}, "blocks": []}, headers={security.ACCESS_HEADER: TOKEN, "X-Request-ID": "req-12345678"})
    assert r.headers["x-request-id"] == "req-12345678"
    rec = [json.loads(x.message) for x in caplog.records if x.name == "valuflow.access"][-1]
    assert rec["requestId"] == "req-12345678" and rec["route"] == "/api/report/pdf" and rec["bucket"] == "report" and rec["status"] in (200, 422) and rec["durationMs"] >= 0
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
