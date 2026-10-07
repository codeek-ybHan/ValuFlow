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

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if request.url.path.endswith("corpCode.xml"):
            return self.corp_response()
        if request.url.path.endswith("company.json"):
            return self.company_response()
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
