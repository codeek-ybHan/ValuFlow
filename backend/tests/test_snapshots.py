"""STEP 10: AI 분석 · Report snapshot 영속화 — 저장/목록/조회/갱신, 민감 정보 제외, 크기 · 형식 검증, DB 없을 때 동작, health."""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.config import Settings
from app.main import create_app
from app.services.financial_store import FinancialStore

SECRET = "SECRET-OPENDART-KEY-99999"


@pytest.fixture
def api(engine, store: FinancialStore):
    with engine.begin() as c:
        c.execute(text("TRUNCATE TABLE ai_analysis_runs, report_snapshots"))
    s = Settings(dart_api_key=SECRET, external_data=False, access_token="tok-123456")
    client = TestClient(create_app(s, store=store), raise_server_exceptions=False)
    client.headers.update({"X-ValuFlow-Access": "tok-123456"})
    return client


def analysis(aid="turn-1", snapshot="ctx-abc12345", excerpt="문서 본문 발췌 SECRET-BODY"):
    return {"analysisId": aid, "question": "영업이익률을 분석해줘", "workflowType": "full-valuation-review", "contextSnapshotId": snapshot, "createdAt": "2026-10-08T00:00:00Z", "groundingLevel": "claim-evidence",
            "corpCode": "00126380", "companyName": "삼성전자",
            "claims": [{"claimId": "c1", "text": "2025년 영업이익률은 13.07%이다.", "type": "fact", "basis": "objective", "evidenceIds": ["e1"], "status": "supported", "numbers": [], "issues": [], "confidenceNotes": []},
                       {"claimId": "c2", "text": "해석", "type": "interpretation", "basis": "judgment", "evidenceIds": ["e1"], "status": "partially-supported", "numbers": [], "issues": [], "confidenceNotes": []}],
            "evidence": [{"evidenceId": "e1", "tool": "getHistoricalAnalysis", "sourceType": "financial-data", "sourceKind": "actual", "excerpt": excerpt, "rawResult": {"huge": "tool output"}}],
            "sources": [], "limitations": ["제한"]}


def report_model(rid="rpt-abc123", snapshot="ctx-abc12345"):
    return {"model": {"schemaVersion": "1.0", "metadata": {"reportId": rid, "snapshot": {"contextSnapshotId": snapshot, "inputHash": "h1"}, "company": {"name": "삼성전자", "corpCode": "00126380"}}, "executiveSummary": {"x": 1}},
            "templateVersion": "valuation-standard-v1@1.0"}


def test_analysis_roundtrip_strips_excerpt_and_raw_results(api):
    saved = api.post("/api/analyses", json=analysis())
    assert saved.status_code == 200 and saved.json()["id"] == "turn-1" and saved.json()["groundingSummary"] == {"claims": 2, "supported": 1, "evidence": 1}
    got = api.get("/api/analyses/turn-1").json()
    a = got["analysis"]
    assert a["claims"][0]["text"] == "2025년 영업이익률은 13.07%이다." and a["contextSnapshotId"] == "ctx-abc12345" and got["companyName"] == "삼성전자"
    dumped = json.dumps(got, ensure_ascii=False)
    assert "SECRET-BODY" not in dumped and "tool output" not in dumped and "excerpt" not in dumped and "rawResult" not in dumped, "문서 발췌 · Tool 원문은 저장하지 않는다"
    listing = api.get("/api/analyses?corpCode=00126380").json()["items"]
    assert [i["id"] for i in listing] == ["turn-1"] and listing[0]["question"].startswith("영업이익률") and "payload" not in listing[0]
    assert api.get("/api/analyses?corpCode=00164779").json()["items"] == []


def test_analysis_upsert_and_order(api):
    api.post("/api/analyses", json=analysis("a1"))
    api.post("/api/analyses", json=analysis("a2"))
    api.post("/api/analyses", json={**analysis("a1"), "question": "수정된 질문"})
    items = api.get("/api/analyses").json()["items"]
    assert sorted(i["id"] for i in items) == ["a1", "a2"] and next(i for i in items if i["id"] == "a1")["question"] == "수정된 질문"


def test_report_snapshot_roundtrip(api):
    assert api.post("/api/report-snapshots", json=report_model()).status_code == 200
    got = api.get("/api/report-snapshots/rpt-abc123").json()
    assert got["model"]["executiveSummary"] == {"x": 1} and got["templateVersion"].startswith("valuation-standard-v1")
    items = api.get("/api/report-snapshots?corpCode=00126380").json()["items"]
    assert items[0]["reportId"] == "rpt-abc123" and items[0]["contextSnapshotId"] == "ctx-abc12345" and "model" not in items[0]


def test_invalid_payloads_are_rejected(api):
    for bad in [{}, {**analysis(), "analysisId": "../x"}, {**analysis(), "claims": "no"}, {**analysis(), "groundingLevel": "none"}, {**analysis(), "contextSnapshotId": ""}]:
        r = api.post("/api/analyses", json=bad)
        assert r.status_code == 422 and r.json()["error"]["code"] == "invalid-payload", bad
    assert api.post("/api/report-snapshots", json={"model": {"metadata": {}}}).status_code == 422
    assert api.get("/api/analyses/missing").status_code == 404 and api.get("/api/report-snapshots/nope").status_code == 404
    assert api.get("/api/analyses/bad%20id").status_code == 400   # 형식이 틀린 id 는 invalid-request


def test_credentials_and_oversize_are_not_stored(api):
    leaked = analysis()
    leaked["limitations"] = [f"key {SECRET}"]
    r = api.post("/api/analyses", json=leaked)
    assert r.status_code == 422 and SECRET not in r.text
    big = analysis()
    big["limitations"] = ["x" * 700_000]
    assert api.post("/api/analyses", json=big).status_code == 413


def test_persisted_data_survives_new_app_instance(engine, store, api):
    """새로고침 · 재시작 뒤에도 (같은 DB 로 만든 새 app 에서) 저장된 분석 · Report 를 읽을 수 있다."""
    api.post("/api/analyses", json=analysis())
    api.post("/api/report-snapshots", json=report_model())
    again = TestClient(create_app(Settings(dart_api_key=SECRET, external_data=False, access_token="tok-123456"), store=store), raise_server_exceptions=False)
    again.headers.update({"X-ValuFlow-Access": "tok-123456"})
    assert again.get("/api/analyses/turn-1").json()["analysis"]["claims"][0]["claimId"] == "c1"
    assert again.get("/api/report-snapshots/rpt-abc123").status_code == 200
    h = again.get("/api/health").json()
    assert h["database"] == "ok" and h["persistenceAvailable"] is True and h["status"] == "ok"


def test_snapshot_endpoints_require_access_and_db():
    no_db = TestClient(create_app(Settings(dart_api_key=SECRET, external_data=False)), raise_server_exceptions=False)
    r = no_db.post("/api/analyses", json=analysis())
    assert r.status_code == 503 and r.json()["error"]["code"] == "persistence-unavailable"
    guarded = TestClient(create_app(Settings(dart_api_key=SECRET, external_data=False, access_token="tok-123456")), raise_server_exceptions=False)
    assert guarded.get("/api/analyses").status_code == 401 and guarded.post("/api/report-snapshots", json={}).status_code == 401


def test_health_degraded_when_database_unreachable():
    from sqlalchemy.exc import OperationalError

    class BadSession:
        def __enter__(self):
            raise OperationalError("x", {}, Exception("connection refused host=db.internal password=hunter2"))
        def __exit__(self, *a):
            return False

    class BadStore:
        session_factory = staticmethod(lambda: BadSession())
        def upsert_company(self, **k): ...
    app = create_app(Settings(dart_api_key=SECRET, external_data=False), store=BadStore())   # type: ignore[arg-type]
    body = TestClient(app, raise_server_exceptions=False).get("/api/health").json()
    assert body["database"] == "unavailable" and body["status"] == "degraded" and body["persistenceAvailable"] is False
    assert "hunter2" not in json.dumps(body) and "db.internal" not in json.dumps(body)


def test_migrations_apply_from_empty_database(pg_url):
    """alembic upgrade head 가 빈 DB 에서 끝까지 적용되어 pgvector 와 새 테이블이 있다."""
    from sqlalchemy import create_engine, inspect
    e = create_engine(pg_url)
    with e.connect() as c:
        assert c.execute(text("SELECT 1 FROM pg_extension WHERE extname='vector'")).scalar() == 1
        assert c.execute(text("SELECT version_num FROM alembic_version")).scalar() == "0004"
    assert {"ai_analysis_runs", "report_snapshots", "disclosure_chunks"} <= set(inspect(e).get_table_names())
    e.dispose()
