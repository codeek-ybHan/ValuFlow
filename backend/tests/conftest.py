"""테스트 helper: 실제 OpenDART 를 호출하지 않고 httpx.MockTransport 로 응답을 흉내 낸다."""
from __future__ import annotations

import io
import json
import zipfile
from typing import Callable

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.dart.client import DartHttpClient
from app.main import create_app

SECRET = "TEST-SECRET-KEY-1234567890"

CORP_XML = """<?xml version="1.0" encoding="UTF-8"?>
<result>
  <list><corp_code>00126380</corp_code><corp_name>삼성전자</corp_name><corp_eng_name>SAMSUNG ELECTRONICS CO,.LTD</corp_eng_name><stock_code>005930</stock_code><modify_date>20240101</modify_date></list>
  <list><corp_code>00100001</corp_code><corp_name>삼성전자서비스</corp_name><corp_eng_name>X</corp_eng_name><stock_code> </stock_code><modify_date>20230101</modify_date></list>
  <list><corp_code>00100002</corp_code><corp_name>삼성전자판매</corp_name><corp_eng_name>Y</corp_eng_name><stock_code>111111</stock_code><modify_date>20230202</modify_date></list>
  <list><corp_code>00100003</corp_code><corp_name>우리삼성전자부품</corp_name><corp_eng_name>Z</corp_eng_name><stock_code> </stock_code><modify_date>20230303</modify_date></list>
  <list><corp_code>00164779</corp_code><corp_name>SK하이닉스</corp_name><corp_eng_name>SK hynix</corp_eng_name><stock_code>000660</stock_code><modify_date>20240202</modify_date></list>
  <list><corp_code>00100004</corp_code><corp_name>하이닉스소재</corp_name><corp_eng_name>H</corp_eng_name><stock_code> </stock_code><modify_date>20220202</modify_date></list>
</result>
""".encode("utf-8")

COMPANY_BODY = {
    "status": "000", "message": "정상", "corp_code": "00126380", "corp_name": "삼성전자(주)", "corp_name_eng": "SAMSUNG ELECTRONICS CO,.LTD",
    "stock_name": "삼성전자", "stock_code": "005930", "ceo_nm": "홍길동", "corp_cls": "Y", "jurir_no": "1301110006246", "bizr_no": "1248100998",
    "adres": "경기도 수원시", "hm_url": "www.samsung.com/sec", "ir_url": "", "phn_no": "031-200-1114", "fax_no": "", "induty_code": "264",
    "est_dt": "19690113", "acc_mt": "12",
}


def row(sj: str, name: str, values: tuple[str | None, str | None, str | None], account_id: str | None = None, year: int = 2025, **extra) -> dict:
    """OpenDART fnlttSinglAcntAll 응답 행 (당기 / 전기 / 전전기)."""
    th, fr, bf = values
    r = {"rcept_no": "20260310002820", "reprt_code": "11011", "bsns_year": str(year), "corp_code": "00126380", "sj_div": sj,
         "sj_nm": {"BS": "재무상태표", "IS": "손익계산서", "CIS": "포괄손익계산서", "CF": "현금흐름표", "SCE": "자본변동표"}[sj], "account_id": account_id or "-표준계정코드 미사용-",
         "account_nm": name, "account_detail": "-", "thstrm_nm": f"제 {year-1968} 기", "thstrm_amount": th, "frmtrm_nm": "전기", "frmtrm_amount": fr,
         "bfefrmtrm_nm": "전전기", "bfefrmtrm_amount": bf, "ord": "1", "currency": "KRW"}
    r.update(extra)
    return r


def sample_rows(year: int = 2025) -> list[dict]:
    return [
        row("BS", "자산총계", ("566,942,110,000,000", "514,531,948,000,000", "455,905,980,000,000"), "ifrs-full_Assets", year),
        row("BS", "재고자산", ("52,636,828,000,000", "51,754,865,000,000", "51,625,874,000,000"), "ifrs-full_Inventories", year),
        row("IS", "매출액", ("333,605,938,000,000", "300,870,903,000,000", "258,935,494,000,000"), "ifrs-full_Revenue", year),
        row("IS", "영업이익", ("43,601,051,000,000", "32,725,961,000,000", "6,566,976,000,000"), "dart_OperatingIncomeLoss", year),
        row("CIS", "당기순이익", ("45,206,805,000,000", "34,451,351,000,000", "15,487,100,000,000"), "ifrs-full_ProfitLoss", year),
        row("CF", "영업활동현금흐름", ("85,315,148,000,000", "72,982,621,000,000", "44,137,427,000,000"), "ifrs-full_CashFlowsFromUsedInOperatingActivities", year),
    ]


def default_financials(request: httpx.Request) -> httpx.Response:
    if request.url.params.get("fs_div") == "CFS":
        return httpx.Response(200, json={"status": "000", "message": "정상", "list": sample_rows(int(request.url.params["bsns_year"]))})
    return httpx.Response(200, json={"status": "013", "message": "조회된 데이타가 없습니다."})


def make_zip(xml: bytes = CORP_XML, name: str = "CORPCODE.xml") -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr(name, xml)
    return buf.getvalue()


class FakeDart:
    """요청 기록 + 경로별 응답. handler(request) 를 바꿔 끼울 수 있다."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.company_response: Callable[[], httpx.Response] = lambda: httpx.Response(200, json=COMPANY_BODY)
        self.corp_response: Callable[[], httpx.Response] = lambda: httpx.Response(200, content=make_zip())
        # 재무제표: request 를 받아 응답을 만든다 (기본: 연결(CFS)만 있고 별도(OFS)는 데이터 없음 013)
        self.financials_response: Callable[[httpx.Request], httpx.Response] = default_financials

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if request.url.path.endswith("corpCode.xml"):
            return self.corp_response()
        if request.url.path.endswith("company.json"):
            return self.company_response()
        if request.url.path.endswith("fnlttSinglAcntAll.json"):
            return self.financials_response(request)
        return httpx.Response(404)

    def count(self, suffix: str) -> int:
        return sum(1 for r in self.requests if r.url.path.endswith(suffix))


@pytest.fixture
def fake() -> FakeDart:
    return FakeDart()


@pytest.fixture
def make_client(fake: FakeDart):
    def build(api_key: str = SECRET, **kw) -> TestClient:
        settings = Settings(dart_api_key=api_key)
        http = httpx.Client(transport=httpx.MockTransport(fake))
        return TestClient(create_app(settings, DartHttpClient(settings, http)), raise_server_exceptions=False, **kw)
    return build


@pytest.fixture
def client(make_client) -> TestClient:
    return make_client()


def to_json(response) -> str:
    return json.dumps(response.json(), ensure_ascii=False)


# ---------------------------------------------------------------------------------------------------------------------
# PostgreSQL 테스트 환경: TEST_DATABASE_URL 이 있으면 그 DB 를, 없으면 pgserver(임시 PostgreSQL)를 쓴다. 둘 다 없으면 DB 테스트를 skip 한다.
# ---------------------------------------------------------------------------------------------------------------------
import os
import tempfile
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.db.session import normalize_database_url
from app.services.financial_store import FinancialStore

BACKEND = Path(__file__).resolve().parents[1]
FIXTURES = BACKEND.parent / "src" / "data" / "fixtures"


def alembic_config(url: str):
    from alembic.config import Config
    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "alembic"))
    cfg.set_main_option("sqlalchemy.url", url.replace("%", "%%"))
    return cfg


@pytest.fixture(scope="session")
def pg_url():
    url = os.environ.get("TEST_DATABASE_URL")
    server = None
    if not url:
        try:
            import pgserver
        except ImportError:
            pytest.skip("PostgreSQL 이 없습니다 (TEST_DATABASE_URL 또는 pgserver 필요)")
        server = pgserver.get_server(tempfile.mkdtemp(prefix="valuflow-pg-"), cleanup_mode="stop")
        url = server.get_uri()
    url = normalize_database_url(url)
    from alembic import command
    command.upgrade(alembic_config(url), "head")
    yield url
    if server is not None:
        server.cleanup()


@pytest.fixture
def engine(pg_url):
    e = create_engine(pg_url)
    with e.begin() as c:
        c.execute(text("TRUNCATE TABLE unsupported_results, data_quality, normalized_financials, raw_financial_accounts, financial_fetches, companies RESTART IDENTITY CASCADE"))
    yield e
    e.dispose()


@pytest.fixture
def store(engine) -> FinancialStore:
    return FinancialStore(sessionmaker(bind=engine, expire_on_commit=False))


DB_CORP_XML = """<?xml version="1.0" encoding="UTF-8"?>
<result>
  <list><corp_code>00126380</corp_code><corp_name>삼성전자</corp_name><corp_eng_name>SAMSUNG ELECTRONICS CO,.LTD</corp_eng_name><stock_code>005930</stock_code><modify_date>20240101</modify_date></list>
  <list><corp_code>00164742</corp_code><corp_name>현대자동차</corp_name><corp_eng_name>HYUNDAI MOTOR CO</corp_eng_name><stock_code>005380</stock_code><modify_date>20240101</modify_date></list>
  <list><corp_code>00266961</corp_code><corp_name>NAVER</corp_name><corp_eng_name>NAVER Corp</corp_eng_name><stock_code>035420</stock_code><modify_date>20240101</modify_date></list>
  <list><corp_code>00688996</corp_code><corp_name>KB금융</corp_name><corp_eng_name>KB Financial Group</corp_eng_name><stock_code>105560</stock_code><modify_date>20240101</modify_date></list>
  <list><corp_code>00999999</corp_code><corp_name>비상장테스트</corp_name><corp_eng_name>Unlisted</corp_eng_name><stock_code> </stock_code><modify_date>20240101</modify_date></list>
</result>
""".encode("utf-8")


def opendart_rows(fixture_name: str, report_year: int = 2025) -> list[dict]:
    """프론트 fixture(실제 OpenDART 응답에서 추린 것)를 OpenDART 응답 행 형식(당기/전기/전전기)으로 되돌린다."""
    accounts = json.loads((FIXTURES / f"{fixture_name}DartFinancials.json").read_text(encoding="utf-8"))["accounts"]
    grouped: dict[tuple, dict] = {}
    for a in accounts:
        key = (a["rawStatementType"], a.get("accountId"), a["accountName"])
        raw = a.get("raw") or {}
        row = grouped.setdefault(key, {"sj_div": a["rawStatementType"], "account_id": a.get("accountId") or "-표준계정코드 미사용-", "account_nm": a["accountName"],
                                       "account_detail": "-", "currency": a.get("currency") or "KRW", "ord": str(raw.get("ord", "1")), "bsns_year": str(report_year)})
        field = {0: "thstrm", 1: "frmtrm", 2: "bfefrmtrm"}[report_year - a["fiscalYear"]]
        row[f"{field}_amount"] = None if a["amount"] is None else str(int(a["amount"]))
    return list(grouped.values())


class DbFake(FakeDart):
    """기업별 재무제표 응답을 돌려주는 FakeDart. 연결(CFS)만 있고 별도(OFS)는 데이터 없음."""

    def __init__(self) -> None:
        super().__init__()
        self.fixture_for: dict[str, str] = {"00126380": "samsung", "00164742": "hyundai", "00266961": "naver", "00688996": "kb"}
        self.corp_response = lambda: httpx.Response(200, content=make_zip(DB_CORP_XML))
        self.financials_response = self._respond

    def _respond(self, request: httpx.Request) -> httpx.Response:
        p = request.url.params
        if p.get("fs_div") != "CFS":
            return httpx.Response(200, json={"status": "013", "message": "no data"})
        name = self.fixture_for.get(p["corp_code"])
        if name is None:
            return httpx.Response(200, json={"status": "013", "message": "no data"})
        return httpx.Response(200, json={"status": "000", "message": "정상", "list": opendart_rows(name, int(p["bsns_year"]))})


@pytest.fixture
def dbfake() -> DbFake:
    return DbFake()


@pytest.fixture
def db_client(dbfake: DbFake, store: FinancialStore) -> TestClient:
    settings = Settings(dart_api_key=SECRET)
    http = httpx.Client(transport=httpx.MockTransport(dbfake))
    return TestClient(create_app(settings, DartHttpClient(settings, http), store=store), raise_server_exceptions=False)
