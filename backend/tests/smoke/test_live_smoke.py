"""실제 OpenDART 연결 smoke test.

DART_API_KEY 가 (환경변수 또는 backend/.env 에) 있을 때만 실행하고, 없으면 skip 한다 (CI 는 OpenDART 에 의존하지 않는다).
"""
import pytest
from fastapi.testclient import TestClient

from app.config import load_settings
from app.main import create_app

settings = load_settings()  # 환경변수 > backend/.env

pytestmark = pytest.mark.skipif(not settings.has_api_key, reason="DART_API_KEY 가 없어 실제 OpenDART smoke test 를 건너뜁니다.")


def test_samsung_search_and_detail():
    client = TestClient(create_app(settings))
    found = client.get("/api/companies", params={"q": "삼성전자"}).json()["items"]
    samsung = next(i for i in found if i["stockCode"] == "005930")
    assert samsung["corpName"] == "삼성전자"
    detail = client.get(f"/api/companies/{samsung['corpCode']}").json()
    assert detail["stockCode"] == "005930" and detail["corpCode"] == samsung["corpCode"]


def test_samsung_financials_three_years():
    """삼성전자(00126380) 최근 3개 사업연도 재무제표: raw rows, BS / IS / CF, Revenue / Operating Profit 존재."""
    client = TestClient(create_app(settings))
    r = client.get("/api/companies/00126380/financials", params={"years": "2023,2024,2025"})
    assert r.status_code == 200, r.text[:200]
    body = r.json()
    accounts = body["accounts"]
    assert len(accounts) > 0 and body["quality"]["rawAccountCount"] == len(accounts)
    assert {a["statementType"] for a in accounts} >= {"BS", "IS", "CF"}
    assert body["quality"]["missingYears"] == [] and body["quality"]["basisUsed"] == "Consolidated"
    for name in ("매출액", "영업이익"):
        years = {a["fiscalYear"] for a in accounts if a["accountName"] == name and a["amount"] is not None}
        assert years >= {2023, 2024, 2025}, name
    assert settings.dart_api_key not in r.text
