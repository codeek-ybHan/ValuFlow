"""실제 OpenDART 연결 smoke test. DART_API_KEY 환경변수가 있을 때만 실행하고, 없으면 skip 한다 (CI 는 OpenDART 에 의존하지 않는다)."""
import os

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

pytestmark = pytest.mark.skipif(not os.environ.get("DART_API_KEY"), reason="DART_API_KEY 가 없어 실제 OpenDART smoke test 를 건너뜁니다.")


def test_samsung_search_and_detail():
    client = TestClient(create_app(Settings(dart_api_key=os.environ["DART_API_KEY"])))
    found = client.get("/api/companies", params={"q": "삼성전자"}).json()["items"]
    samsung = next(i for i in found if i["stockCode"] == "005930")
    assert samsung["corpName"] == "삼성전자"
    detail = client.get(f"/api/companies/{samsung['corpCode']}").json()
    assert detail["stockCode"] == "005930" and detail["corpCode"] == samsung["corpCode"]
