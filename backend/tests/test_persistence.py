"""PostgreSQL 영속 저장 테스트 (실제 PostgreSQL 사용, OpenDART 는 mock)."""
import json
from datetime import datetime, timezone

import httpx
import pytest
from sqlalchemy import func, inspect, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import Settings
from app.dart.models import FinancialAccount, FinancialsQuality
from app.db.models import Base, Company, DataQualityRecord, FinancialFetch, NormalizedFinancial, RawFinancialAccount, UnsupportedResult
from app.db.session import create_db_engine, normalize_database_url
from app.services.financial_store import FetchKey
from tests.conftest import BACKEND, SECRET, alembic_config

SAMSUNG = "00126380"
Y = {"years": "2023,2024,2025"}
GOLDEN = BACKEND / "tests" / "golden" / "samsung.json"


def fin_calls(dbfake) -> int:
    return sum(1 for r in dbfake.requests if r.url.path.endswith("fnlttSinglAcntAll.json"))


def total_calls(dbfake) -> int:
    return len(dbfake.requests)


def get(db_client, corp=SAMSUNG, **params):
    r = db_client.get(f"/api/companies/{corp}/historical", params={**Y, **params})
    assert r.status_code == 200, r.text
    return r.json()


def fa(name="매출액", year=2025, amount=1_000_000, st="IS", id_="ifrs-full_Revenue", detail="-"):
    return FinancialAccount(account_name=name, account_id=id_, statement_type=st, raw_statement_type=st, basis="Consolidated", fiscal_year=year, report_year=2025,
                            amount=amount, currency="KRW", raw={"account_detail": detail, "account_nm": name})


def fq(years=(2025,)):
    return FinancialsQuality(basis_requested="Consolidated", basis_used="Consolidated", basis_fallback=False, years_requested=list(years), years_received=list(years),
                             missing_years=[], raw_account_count=1, warnings=["w1"])


QUALITY = {"basisRequested": "Consolidated", "basisUsed": "Consolidated", "basisFallback": False, "fields": {}, "warnings": [], "trace": [], "checks": []}
NOW = datetime(2026, 1, 1, tzinfo=timezone.utc)
KEY = FetchKey(SAMSUNG, "11011", "auto", (2025,))


def minimal_ok(year=2025):
    sec = {"incomeStatement": ("revenue", "cogs", "grossProfit", "sga", "operatingProfit", "netIncome"),
           "balanceSheet": ("accountsReceivable", "inventory", "accountsPayable", "totalAssets", "totalLiabilities", "totalEquity"),
           "cashFlow": ("cfo", "ppeAcquisition", "intangibleAcquisition")}
    data = {"meta": {"source": "DART Annual Report"}, "company": {"name": "x", "ticker": "", "basis": "Consolidated", "currency": "KRW", "unit": "million", "period": [f"{year}A"]}}
    data.update({s: {f: [1.0] for f in fields} for s, fields in sec.items()})
    return {"ok": True, "data": data, "quality": QUALITY}


# 1·2. 기업
def test_company_upsert_and_nullable_stock_code(store):
    a = store.upsert_company(corp_code=SAMSUNG, corp_name="삼성전자", stock_code="005930", corp_name_eng="SAMSUNG")
    b = store.upsert_company(corp_code=SAMSUNG, corp_name="삼성전자(주)", corp_class="Y")  # stock_code / eng 는 None 이어도 기존 값을 지우지 않는다
    assert a["id"] == b["id"]
    got = store.get_company(SAMSUNG)
    assert (got["corpName"], got["stockCode"], got["corpNameEng"], got["corpClass"]) == ("삼성전자(주)", "005930", "SAMSUNG", "Y")
    assert store.counts()["companies"] == 1
    unlisted = store.upsert_company(corp_code="00999999", corp_name="비상장테스트")
    assert store.get_company("00999999")["stockCode"] is None and unlisted["id"] != a["id"]


# 3·4·5. fetch 메타 / Raw / null amount
def test_fetch_metadata_raw_and_null_amount(store, engine):
    accounts = [fa(), fa("재고자산", amount=None, st="BS", id_=None), fa("재고자산", year=2024, amount=3, st="BS", id_=None)]
    fid = store.save_outcome(company={"corpCode": SAMSUNG, "corpName": "삼성전자", "stockCode": "005930"}, key=KEY, fetch_quality=fq(),
                             accounts=accounts, result=minimal_ok(), fetched_at=NOW)
    with Session(engine) as s:
        f = s.get(FinancialFetch, fid)
        assert (f.status, f.is_current, f.basis_mode, f.basis_used, f.report_code, f.years_key, f.requested_years, f.warnings, f.raw_account_count) == \
               ("success", True, "auto", "Consolidated", "11011", "2025", [2025], ["w1"], 1)
        raws = s.execute(select(RawFinancialAccount).where(RawFinancialAccount.fetch_id == fid).order_by(RawFinancialAccount.id)).scalars().all()
        assert len(raws) == 3
        assert raws[1].amount is None, "빈 금액은 0 이 아니라 NULL"
        assert raws[0].raw["account_nm"] == "매출액" and raws[0].unit == "KRW" and raws[1].account_id is None
    back = store.load_raw(fid)
    assert [a.amount for a in back] == [1_000_000, None, 3] and back[1].account_id is None


# 6·7·8·15. 실제 삼성전자 데이터 round trip
def test_historical_roundtrip_quality_trace_and_domain_compat(db_client, dbfake, store):
    fresh = get(db_client)
    assert fresh["status"] == "ok" and fresh["source"] == "opendart" and fresh["persisted"] is True and fresh["fetchId"] == 1
    stored = get(db_client)
    assert stored["source"] == "database"
    # 저장 → 복원 결과가 방금 정규화한 결과와 같다 (HistoricalData / DataQuality / trace / checks)
    assert stored["data"] == fresh["data"]
    assert stored["quality"] == fresh["quality"]
    assert stored["fetchedAt"] == fresh["fetchedAt"]
    assert stored["fetch"] == fresh["fetch"]
    q = stored["quality"]
    assert q["fields"]["revenue"]["matchType"] == "account-id" and q["fields"]["depreciationAmortization"]["status"] == "missing"
    rev = next(t for t in q["trace"] if t["canonicalField"] == "revenue" and t["fiscalYear"] == 2025)
    assert (rev["sourceAccountName"], rev["sourceAccountId"], rev["matchType"], rev["basis"]) == ("매출액", "ifrs-full_Revenue", "account-id", "CFS")
    debt = next(t for t in q["trace"] if t["canonicalField"] == "interestBearingDebt" and t["fiscalYear"] == 2025)
    assert [c["accountName"] for c in debt["components"]] == ["단기차입금", "유동성장기부채", "사채", "장기차입금"]  # components 보존
    assert "D&A not available from current OpenDART financial statement source." in q["warnings"]
    assert any(c["name"] == "assets = liabilities + equity" and c["status"] == "pass" for c in q["checks"])
    # 기존 domain model(HistoricalData)과 호환: TS normalizer 결과(golden)와 같은 필드 구조 / 값
    golden = json.loads(GOLDEN.read_text(encoding="utf-8"))["expected"]["data"]
    d = stored["data"]
    for sec in ("incomeStatement", "balanceSheet", "cashFlow"):
        assert d[sec] == golden[sec], sec
    assert d["company"]["period"] == ["2023A", "2024A", "2025A"] and d["company"]["basis"] == "Consolidated"
    assert d["meta"]["corpCode"] == SAMSUNG and d["meta"]["stockCode"] == "005930" and d["meta"]["source"] == "DART Annual Report"
    assert d["company"]["name"] == "삼성전자" and d["company"]["ticker"] == "005930"
    # data_quality 행에 수집 품질이 함께 저장된다
    rec = store.get_fetch(1)
    assert rec["fetch"]["yearsReceived"] == [2023, 2024, 2025] and rec["fetch"]["missingYears"] == [] and rec["fetch"]["basisFallback"] is False


def test_quality_columns_in_data_quality_table(db_client, engine):
    get(db_client)
    with Session(engine) as s:
        r = s.execute(select(DataQualityRecord)).scalar_one()
        assert (r.status, r.basis_used, r.basis_fallback, r.years_received, r.missing_years) == ("success", "Consolidated", False, [2023, 2024, 2025], [])
        assert r.fields["revenue"]["status"] == "available" and len(r.trace) > 30 and len(r.checks) > 5 and isinstance(r.warnings, list)


# 9. unsupported 저장
@pytest.mark.parametrize("corp,code", [("00688996", "unsupported-industry"), ("00266961", "unsupported-structure")])
def test_unsupported_saved_and_reused(db_client, dbfake, engine, corp, code):
    first = get(db_client, corp)
    assert first["status"] == "unsupported" and first["code"] == code and first["persisted"] is True and "data" not in first
    calls = total_calls(dbfake)
    again = get(db_client, corp)  # DB 에서 바로 — OpenDART 호출 없음
    assert again["source"] == "database" and again["code"] == code and again["reason"] == first["reason"]
    assert total_calls(dbfake) == calls
    with Session(engine) as s:
        u = s.execute(select(UnsupportedResult)).scalar_one()
        assert (u.code, u.years_key) == (code, "2023,2024,2025") and u.reason and "warnings" in u.detail
        f = s.get(FinancialFetch, u.fetch_id)
        assert f.status == code and f.is_current
        assert s.execute(select(func.count()).select_from(NormalizedFinancial)).scalar_one() == 0, "정규화 값은 만들지 않는다"
        assert s.execute(select(func.count()).select_from(RawFinancialAccount)).scalar_one() > 0, "Raw 는 재정규화를 위해 보존한다"
    refreshed = get(db_client, corp, refresh="true")  # refresh 로 재시도
    assert refreshed["source"] == "opendart" and total_calls(dbfake) > calls
    with Session(engine) as s:
        assert s.execute(select(func.count()).select_from(UnsupportedResult)).scalar_one() == 1, "미지원 결과는 key 당 하나"


# 10. idempotency
def test_idempotency_policy(db_client, dbfake, store, engine):
    get(db_client)
    get(db_client)
    get(db_client)
    assert store.counts()["financial_fetches"] == 1 and fin_calls(dbfake) == 1, "같은 조회를 반복해도 쌓이지 않는다"
    r = get(db_client, refresh="true")
    assert r["fetchId"] == 2
    with Session(engine) as s:
        fetches = s.execute(select(FinancialFetch).order_by(FinancialFetch.id)).scalars().all()
        assert [(f.id, f.is_current) for f in fetches] == [(1, False), (2, True)], "이력은 남기고 current 는 하나"
        n1 = s.execute(select(func.count()).select_from(RawFinancialAccount).where(RawFinancialAccount.fetch_id == 1)).scalar_one()
        n2 = s.execute(select(func.count()).select_from(RawFinancialAccount).where(RawFinancialAccount.fetch_id == 2)).scalar_one()
        assert n1 == n2 > 0, "기존 Raw 를 지우지 않고 fetch 단위로 격리"
        # DB 제약: current 는 key 당 하나, Raw 중복 불가
        with pytest.raises(IntegrityError):
            s.add(FinancialFetch(company_id=fetches[0].company_id, report_code="11011", basis_mode="auto", basis_requested="Consolidated", requested_years=[2023, 2024, 2025],
                                 years_key="2023,2024,2025", received_years=[], missing_years=[], raw_account_count=0, status="success", warnings=[], is_current=True, fetched_at=NOW))
            s.flush()
        s.rollback()
        first_raw = s.execute(select(RawFinancialAccount).where(RawFinancialAccount.fetch_id == 2).limit(1)).scalar_one()
        with pytest.raises(IntegrityError):
            s.add(RawFinancialAccount(fetch_id=2, fiscal_year=first_raw.fiscal_year, report_year=first_raw.report_year, statement_type=first_raw.statement_type, raw_statement_type=first_raw.raw_statement_type,
                                      basis=first_raw.basis, account_id=first_raw.account_id, account_name=first_raw.account_name, account_detail=first_raw.account_detail, raw={}))
            s.flush()
        s.rollback()
    # 다른 연도 조합 / 기준은 별개 key
    get(db_client, years="2024,2025")
    assert store.counts()["financial_fetches"] == 3


def test_raw_dedupe_key_treats_null_account_id_as_empty(store, engine):
    accounts = [fa("현금", id_=None, st="BS"), fa("현금", id_=None, st="BS")]
    with pytest.raises(IntegrityError):
        store.save_outcome(company={"corpCode": SAMSUNG, "corpName": "x"}, key=KEY, fetch_quality=fq(), accounts=accounts, result=minimal_ok(), fetched_at=NOW)
    assert store.counts()["financial_fetches"] == 0


# 11·12. DB hit / miss
def test_database_hit_never_calls_opendart_and_miss_saves(db_client, dbfake, store):
    assert total_calls(dbfake) == 0
    first = get(db_client)
    assert first["source"] == "opendart" and fin_calls(dbfake) == 1  # miss → OpenDART → 저장
    assert store.counts()["normalized_financials"] == 3 and store.counts()["data_quality"] == 1
    n = total_calls(dbfake)
    hit = get(db_client)
    assert hit["source"] == "database" and total_calls(dbfake) == n, "corpCode 목록 / 재무 어느 쪽도 다시 호출하지 않는다"
    # 서버를 다시 띄워도(memory cache 가 비어도) DB 에서 응답한다
    from fastapi.testclient import TestClient
    from app.dart.client import DartHttpClient
    from app.main import create_app
    fresh_fake = type(dbfake)()
    settings = Settings(dart_api_key=SECRET)
    c2 = TestClient(create_app(settings, DartHttpClient(settings, httpx.Client(transport=httpx.MockTransport(fresh_fake))), store=store))
    r = c2.get(f"/api/companies/{SAMSUNG}/historical", params=Y).json()
    assert r["source"] == "database" and fresh_fake.requests == []


# 13. refresh
def test_refresh_refetches_and_bypasses_memory_cache(db_client, dbfake):
    get(db_client)
    assert fin_calls(dbfake) == 1
    r = get(db_client, refresh="true")
    assert r["source"] == "opendart" and fin_calls(dbfake) == 2, "backend memory cache 도 건너뛴다"
    assert get(db_client)["fetchId"] == 2, "이후 조회는 새 current"
    hist = db_client.get(f"/api/companies/{SAMSUNG}/fetches").json()["items"]
    assert [(i["id"], i["isCurrent"]) for i in hist] == [(2, True), (1, False)]


def test_refresh_failure_keeps_existing_data(db_client, dbfake, store):
    get(db_client)
    dbfake.financials_response = lambda r: httpx.Response(200, json={"status": "020", "message": "limit"})
    r = db_client.get(f"/api/companies/{SAMSUNG}/historical", params={**Y, "refresh": "true"})
    assert r.status_code == 429
    assert get(db_client)["source"] == "database" and store.counts()["financial_fetches"] == 1


# 14. 파생 결과는 저장하지 않는다
def test_derived_results_are_not_stored(db_client, engine):
    body = get(db_client)
    assert not {"metrics", "trends", "forecastReference", "valuationResult", "sensitivityResult", "analysis"} & set(body)
    all_names = {t for t in inspect(engine).get_table_names()} - {"alembic_version"}
    snapshot_tables = {"ai_analysis_runs", "report_snapshots"}   # STEP 10: 검증된 AI 분석 · Report snapshot (재무 · 평가 결과 테이블이 아니다)
    assert snapshot_tables <= all_names
    names = all_names - snapshot_tables
    columns = {c["name"] for t in names for c in inspect(engine).get_columns(t)}
    forbidden = ("analysis", "forecast", "valuation", "sensitivity", "trend", "metric")
    assert not [n for n in names | columns if any(w in n for w in forbidden)], "분석 / 평가 결과 테이블 · 컬럼이 없다"
    assert names == {"companies", "financial_fetches", "raw_financial_accounts", "normalized_financials", "data_quality", "unsupported_results", "disclosure_documents", "disclosure_chunks"}
    assert set(Base.metadata.tables) == names | snapshot_tables


# 16. transaction
@pytest.mark.parametrize("target", ["_insert_quality", "_insert_raw", "_replace_normalized"])
def test_transaction_rolls_back_everything_on_failure(db_client, dbfake, store, monkeypatch, target):
    def boom(*a, **k):
        raise __import__("sqlalchemy").exc.OperationalError("stmt", {}, Exception("boom"))

    monkeypatch.setattr(store, target, boom)
    body = get(db_client)
    assert body["status"] == "ok" and body["persisted"] is False and body["persistError"] == "database-error"
    assert "boom" not in json.dumps(body) and SECRET not in json.dumps(body)
    assert set(store.counts().values()) == {0}, store.counts()  # 기업 · fetch · Raw · 정규화 · 품질 어느 것도 남지 않는다
    monkeypatch.undo()
    assert get(db_client)["persisted"] is True and store.counts()["financial_fetches"] == 1


def test_unsupported_save_is_atomic_too(store, monkeypatch):
    monkeypatch.setattr(store, "_insert_quality", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("x")))
    bad = {"ok": False, "code": "unsupported-industry", "reason": "r", "missingRequired": [], "quality": QUALITY}
    with pytest.raises(RuntimeError):
        store.save_outcome(company={"corpCode": SAMSUNG, "corpName": "x"}, key=KEY, fetch_quality=fq(), accounts=[fa()], result=bad, fetched_at=NOW)
    assert set(store.counts().values()) == {0}


# renormalize: Raw 에서 다시 정규화
def test_renormalize_from_stored_raw_without_opendart(db_client, dbfake, store, engine):
    before = get(db_client)
    n = total_calls(dbfake)
    r = db_client.post(f"/api/companies/{SAMSUNG}/historical/renormalize", params=Y)
    assert r.status_code == 200 and r.json()["source"] == "database" and total_calls(dbfake) == n
    after = r.json()
    assert after["data"] == before["data"] and after["quality"]["trace"] == before["quality"]["trace"]
    assert store.counts()["normalized_financials"] == 3 and store.counts()["data_quality"] == 1 and store.counts()["financial_fetches"] == 1
    # 규칙이 바뀐 것처럼 다른 normalize 를 주면 정규화 / 품질만 교체되고 Raw 는 그대로다
    raw_before = store.counts()["raw_financial_accounts"]
    out = store.renormalize(1, lambda raw: {"ok": False, "code": "incomplete", "reason": "새 규칙", "missingRequired": ["inventory"], "quality": {**QUALITY, "warnings": ["새 규칙 warning"]}})
    assert out["status"] == "incomplete" and out["result"]["reason"] == "새 규칙"
    assert store.counts()["raw_financial_accounts"] == raw_before and store.counts()["normalized_financials"] == 0
    assert store.counts()["unsupported_results"] == 1
    assert get(db_client)["status"] == "incomplete"
    assert db_client.post(f"/api/companies/{SAMSUNG}/historical/renormalize", params={"years": "2019,2020,2021"}).json()["error"]["code"] == "no-data"


def test_renormalize_requires_database(make_client):
    r = make_client().post(f"/api/companies/{SAMSUNG}/historical/renormalize", params=Y)
    assert r.json()["error"]["code"] == "invalid-request"


# 복원: 일부 연도만 있는 선택 계정 / 별도 fallback
def test_optional_partial_fields_and_basis_fallback_survive_roundtrip(db_client, dbfake):
    def only_ofs(request):
        if request.url.params["fs_div"] == "OFS":
            return httpx.Response(200, json={"status": "000", "list": __import__("tests.conftest", fromlist=["opendart_rows"]).opendart_rows("samsung", 2025)})
        return httpx.Response(200, json={"status": "013"})

    dbfake.financials_response = only_ofs
    # fixture rows 는 basis 가 Consolidated 로 표시돼 있지만 backend 는 요청한 fs_div 에 맞춰 Separate 로 표기한다
    fresh = get(db_client)
    assert fresh["fetch"]["basisFallback"] is True and fresh["data"]["company"]["basis"] == "Separate"
    stored = get(db_client)
    assert stored["data"] == fresh["data"] and stored["quality"] == fresh["quality"] and stored["fetch"] == fresh["fetch"]
    assert "Separate statements used because consolidated data unavailable" in stored["quality"]["warnings"]


# 설정 / migration / pool
def test_database_url_and_pool_settings(monkeypatch):
    assert normalize_database_url("postgres://u:p@h/db") == "postgresql+psycopg://u:p@h/db"
    assert normalize_database_url("postgresql://u:p@h/db") == "postgresql+psycopg://u:p@h/db"
    assert normalize_database_url("postgresql+psycopg://u:p@h/db") == "postgresql+psycopg://u:p@h/db"
    s = Settings(database_url="postgresql://u:secret@localhost/db")
    assert "secret" not in repr(s) and s.has_database
    e = create_db_engine(s)  # 연결은 첫 사용 때 (생성만으로는 접속하지 않는다)
    assert e.pool.size() == 2 and e.pool._max_overflow == 0
    from sqlalchemy.pool import NullPool
    assert isinstance(create_db_engine(Settings(database_url="postgresql://u:p@h/db", db_pool="null")).pool, NullPool)
    from app.config import load_settings
    assert load_settings({"DATABASE_URL": "postgres://x", "DB_POOL_SIZE": "3", "DB_MAX_OVERFLOW": "1", "DB_POOL": "NULL"}).db_pool == "null"
    assert load_settings({}).has_database is False


def test_migration_matches_models_and_is_reversible(pg_url, engine):
    from alembic import command
    from alembic.autogenerate import compare_metadata
    from alembic.migration import MigrationContext
    with engine.connect() as c:
        assert compare_metadata(MigrationContext.configure(c, opts={"compare_type": True}), Base.metadata) == [], "migration 과 모델이 일치한다"
    cfg = alembic_config(pg_url)
    command.downgrade(cfg, "base")
    assert set(inspect(engine).get_table_names()) <= {"alembic_version"}
    command.upgrade(cfg, "head")
    assert "companies" in inspect(engine).get_table_names()


def test_without_database_service_works_but_does_not_persist(make_client, fake):
    # DATABASE_URL 이 없으면 저장 없이 동작한다 (기존 동작)
    c = make_client()
    assert c.get("/api/health").json()["databaseConfigured"] is False
    r = c.get(f"/api/companies/{SAMSUNG}/historical", params=Y)
    assert r.status_code == 200 and r.json()["persisted"] is False and r.json()["source"] == "opendart"
    assert c.get(f"/api/companies/{SAMSUNG}/fetches").json()["items"] == []


def test_health_reports_database(db_client):
    assert db_client.get("/api/health").json()["databaseConfigured"] is True


def test_errors_do_not_leak_database_url(db_client, dbfake):
    r = db_client.get(f"/api/companies/{SAMSUNG}/historical", params={"years": "2010"})
    assert r.json()["error"]["code"] == "invalid-request"
    assert db_client.get("/api/companies/00000000/historical", params=Y).json()["error"]["code"] == "no-data"  # 기업 목록에 없는 corpCode
